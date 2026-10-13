# Retrieval-augmented generation for Jervis — design

Status: proposal. Nothing in this document is built yet; it describes how the
retrieval layer should sit next to the existing tool-based agent so that
Jervis can also answer from documents (procedures, supplier contracts, meeting
notes, mails) without inventing anything.

## 1. Why a separate layer

The agent today answers from **structured** sources: an intent is matched, a
plan names the tools to call, each tool returns rows or measures, and the
narrative is composed from those facts. That is auditable and exact, and it
stays the path for every numeric question.

Documents are different: the answer is a passage, not a row. The retrieval
layer adds one more tool, `documents.search`, that returns the passages most
relevant to the question together with their source, so the narration can
quote and cite them. The planner decides when to include it (for example,
"what is the escalation procedure for a paint defect", "what did the supplier
promise in their last mail") and the same permission and audit rules apply.

## 2. Pipeline

```
approved sources ──> ingest ──> chunk ──> embed ──> index (per source, per ACL)
                                                         │
question ──> intent + entities ──> planner ──> documents.search ──> rerank ──> passages + citations ──> narration
```

**Ingest.** One connector per source, reusing the integrations pattern
(`server/src/integrations/definitions.js`): SharePoint / OneDrive via Microsoft
Graph, the mailbox (already read for the inbox), a file share, and the issue
history as text. Each document is stored with its id, title, source, owner,
last-modified time and the **access list** it carries in the source system.

**Chunk.** Fixed-size passages (about 400 tokens, 15 percent overlap) with the
document title prepended, so a passage is understandable on its own.

**Embed.** A multilingual embedding model, because the corpus and the
questions will mix German and English. Candidates: Azure OpenAI
`text-embedding-3-large` (if the client is on Azure already) or a self-hosted
`multilingual-e5-large`. The choice is a configuration value, not code.

**Index.** PostgreSQL with `pgvector` is the recommendation: the project
already plans a Postgres adapter (`db/schema.sql`, `DATABASE_URL`), it keeps
one operational database, and it supports a metadata filter in the same query.
Table shape:

```sql
create table doc_chunks (
  id            bigserial primary key,
  document_id   text not null,
  source        text not null,          -- sharepoint | mail | fileshare | issues
  title         text not null,
  chunk_index   int  not null,
  content       text not null,
  language      text,                   -- en | de
  acl           text[] not null,        -- group ids allowed to read
  modified_at   timestamptz not null,
  embedding     vector(1024) not null
);
create index on doc_chunks using hnsw (embedding vector_cosine_ops);
create index on doc_chunks using gin (acl);
```

**Search.** Hybrid: vector similarity plus a keyword match (`tsvector`) merged
with reciprocal-rank fusion, filtered by `acl && user_groups` **inside the SQL
query** so a passage the user may not read is never even scored. Top 20
candidates are reranked (cross-encoder, or the LLM with a short prompt) to the
best 5.

**Narration.** The passages go into the Claude narration prompt with an
instruction to answer only from them and to cite `[n]` per sentence. The
deterministic path (no API key) returns the passages themselves with their
sources, which is still useful. The answer carries `sources[]` exactly like the
structured tools do, so the UI needs no new concept.

## 3. Security and access

- Permissions are enforced at index time (ACL stored with every chunk) and at
  query time (ACL filter in SQL). A re-sync job refreshes ACLs and removes
  chunks for deleted or de-permissioned documents.
- The embedding model only ever sees document text; if a hosted model is used
  the client must approve that data flow, otherwise the self-hosted option.
- Every `documents.search` call is audited with the question, the user, the
  sources touched and the document ids returned, the same as the other tools.
- Prompt-injection defence: document text is data, never instructions. The
  narration prompt states that, passages are delimited, and the answer is
  checked for the citation pattern before it is shown.

## 4. Fit with the current code

| Existing piece | Change |
| --- | --- |
| `server/src/agent/tools/index.js` | add `documents.search` with `permission: 'documents:read'` |
| `server/src/agent/planner.js` | new intents `PROCEDURE_LOOKUP`, `DOCUMENT_QUESTION`; existing intents may append `documents.search` when a document entity is mentioned |
| `server/src/security/roles.js` | `documents:read` per role; group mapping once SSO exists |
| `server/src/data/adapters/postgres.adapter.js` | the vector queries live here, behind the repository contract |
| `server/src/integrations/definitions.js` | `sharepoint` entry (tenant, client id, secret, site ids) |
| `web/src/components/answer-card.tsx` | passages render as a quoted block with the `[n]` citation linked to the source |

## 5. Rollout

1. Index the synthetic issue history and the mock mailbox locally with the
   self-hosted embedding model; prove the ACL filter with the three demo roles.
2. Connect one SharePoint library on the client's test tenant, read-only.
3. Measure answer quality on 30 real questions from Carlos's team; tune chunking
   and reranking.
4. Only then widen the corpus.
