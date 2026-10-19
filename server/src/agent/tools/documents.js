import { getDocumentIndex, groupsForRole } from '../../rag/corpus.js';
import { config } from '../../config.js';

/**
 * documents.search — retrieval over approved documents (RAG).
 *
 * Embeds the question, searches the ACL-filtered document index and returns the
 * most relevant passages with their source, so the narration can quote and cite
 * them. Permissions are enforced twice: the tool carries `documents:read` (the
 * orchestrator skips it for roles without it), and the index is filtered by the
 * user's groups so a passage the role may not read is never scored.
 */
export const documentsSearch = {
  id: 'documents.search',
  source: 'documents',
  label: 'Document search',
  description: 'Find relevant passages in approved procedures and reference documents, with citations.',
  async run({ interpretation, access, language, limit }) {
    const index = getDocumentIndex();
    const query = interpretation?.question ?? '';
    const userGroups = groupsForRole(access?.role);
    const passages = index.search(query, {
      userGroups,
      limit: limit ?? config.rag?.topK ?? 4,
    });

    return {
      data: {
        passages: passages.map((p) => ({
          documentId: p.documentId,
          title: p.title,
          source: p.source,
          language: p.language,
          excerpt: p.content,
          score: Number(p.score.toFixed(3)),
        })),
        language,
      },
      citation: passages[0]
        ? {
            source: 'documents',
            object: passages[0].title,
            detail: `${passages.length} passage${passages.length === 1 ? '' : 's'} from approved documents`,
          }
        : {
            source: 'documents',
            object: 'document index',
            detail: 'no matching passage',
          },
    };
  },
};
