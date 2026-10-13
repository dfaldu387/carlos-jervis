import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Search, MessageSquare, Plus, ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';
import { formatTime } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState, ErrorState, LoadingRows } from '@/components/states';

export function HistoryPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const query = useQuery({
    queryKey: ['conversations', q],
    queryFn: () => api.conversations(q),
    placeholderData: keepPreviousData,
  });
  const items = query.data?.items ?? [];

  return (
    <div>
      <PageHeader title="Conversation History" description="Reopen and continue your previous questions to Jervis.">
        <Button onClick={() => navigate('/ask')}>
          <Plus /> New conversation
        </Button>
      </PageHeader>

      <Card className="mb-4 p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search your conversations" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </Card>

      {query.isError ? (
        <ErrorState message={(query.error as Error).message} onRetry={() => query.refetch()} />
      ) : query.isLoading && !query.data ? (
        <Card className="p-5"><LoadingRows rows={5} /></Card>
      ) : items.length === 0 ? (
        <EmptyState
          title={q ? 'No conversations match' : 'No conversations yet'}
          message={q ? 'Try a different search term.' : 'Ask Jervis a production question and it will appear here, ready to continue.'}
          action={<Button onClick={() => navigate('/ask')}>Ask Jervis</Button>}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => navigate(`/ask?session=${c.id}`)}
              className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 text-left shadow-sm transition-colors hover:bg-secondary/40"
            >
              <MessageSquare className="h-[18px] w-[18px] flex-none text-primary" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-foreground">{c.title}</div>
                <div className="truncate text-xs text-muted-foreground">{c.preview}</div>
              </div>
              <div className="flex-none text-right text-xs text-muted-foreground">
                <div>{c.messageCount} messages</div>
                <div>{formatTime(c.updatedAt)}</div>
              </div>
              <ChevronRight className="h-4 w-4 flex-none text-muted-foreground" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
