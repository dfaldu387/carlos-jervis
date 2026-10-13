import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Flag, Paperclip, Reply, Sparkles, Send, CheckSquare, Search, X } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Banner, EmptyState, ErrorState, LoadingRows } from '@/components/states';
import { useI18n } from '@/lib/i18n';
import type { MailMessage } from '@/lib/types';

type Filter = 'all' | 'unread' | 'needsReply' | 'flagged';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'inbox.filter.all' },
  { id: 'unread', label: 'inbox.filter.unread' },
  { id: 'needsReply', label: 'inbox.filter.needsReply' },
  { id: 'flagged', label: 'inbox.filter.flagged' },
];

const categoryTone: Record<string, 'default' | 'success' | 'warning' | 'destructive' | 'muted'> = {
  supplier: 'warning',
  maintenance: 'default',
  quality: 'destructive',
  hr: 'muted',
  meeting: 'success',
  it: 'muted',
  other: 'muted',
};

function when(iso: string, locale: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay ? d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString(locale, { day: '2-digit', month: 'short' });
}

export function InboxPage() {
  const qc = useQueryClient();
  const { t, language, locale } = useI18n();
  const [params, setParams] = useSearchParams();
  const filter = (params.get('filter') as Filter) || 'all';
  const openId = params.get('open');
  const [q, setQ] = useState(params.get('q') ?? '');
  const [draft, setDraft] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['mail', filter, params.get('q') ?? ''],
    queryFn: () => api.mail({ filter, q: params.get('q') ?? undefined, limit: 50 }),
  });
  const detail = useQuery({
    queryKey: ['mail', 'item', openId],
    queryFn: () => api.mailItem(openId!),
    enabled: Boolean(openId),
    select: (d) => d.item,
  });

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['mail'] });

  // Opening a message marks it read; the draft and confirmation reset.
  useEffect(() => {
    setDraft(null);
    setConfirming(false);
    setSent(null);
    if (detail.data && !detail.data.read) {
      void api.updateMail(detail.data.id, { read: true }).then(invalidate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.data?.id]);

  const flag = useMutation({
    mutationFn: (m: MailMessage) => api.updateMail(m.id, { flagged: !m.flagged }),
    onSuccess: invalidate,
  });
  const makeDraft = useMutation({
    mutationFn: (id: string) => api.draftReply(id, { language }),
    onSuccess: (r) => setDraft(r.draft.body),
  });
  const send = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => api.sendReply(id, body),
    onSuccess: (r) => {
      setConfirming(false);
      setDraft(null);
      setSent(r.mode === 'simulated' ? t('inbox.simulated') : t('inbox.sent'));
      invalidate();
    },
  });
  const toTask = useMutation({
    mutationFn: (m: MailMessage) => api.createTask({ title: t('inbox.followUp', { subject: m.subject }), relatedMailId: m.id }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['tasks'] }),
  });

  const m = detail.data;

  return (
    <div>
      <PageHeader title={t('inbox.title')} description={t('inbox.subtitle')}>
        {list.data?.mode === 'mock' ? (
          <Badge variant="muted">{t('inbox.mock')}</Badge>
        ) : list.data?.mode ? (
          <Badge variant="success">{t('inbox.connected')}</Badge>
        ) : null}
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* List */}
        <Card className="flex min-h-[60vh] flex-col overflow-hidden">
          <div className="flex flex-col gap-2 border-b border-border p-3">
            <form
              className="relative"
              onSubmit={(e) => {
                e.preventDefault();
                setParam('q', q.trim() || null);
              }}
            >
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('inbox.search')} className="h-9 pl-9 pr-8" />
              {q ? (
                <button
                  type="button"
                  aria-label={t('inbox.clear')}
                  onClick={() => {
                    setQ('');
                    setParam('q', null);
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </form>
            <div className="flex flex-wrap gap-1">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setParam('filter', f.id === 'all' ? null : f.id)}
                  className={cn(
                    'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                    filter === f.id ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t(f.label)}
                  {f.id === 'unread' && list.data ? ` · ${list.data.unread}` : ''}
                  {f.id === 'needsReply' && list.data ? ` · ${list.data.needsReply}` : ''}
                </button>
              ))}
            </div>
          </div>

          {list.isLoading ? (
            <div className="p-4">
              <LoadingRows rows={6} />
            </div>
          ) : null}
          {list.isError ? <ErrorState message={(list.error as Error).message} onRetry={() => void list.refetch()} /> : null}
          {list.data && list.data.items.length === 0 ? <EmptyState title={t('inbox.none')} message={t('inbox.noneDetail')} /> : null}

          <ul className="flex-1 divide-y divide-border overflow-y-auto">
            {list.data?.items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setParam('open', item.id)}
                  className={cn(
                    'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/50',
                    openId === item.id && 'bg-secondary/60',
                  )}
                >
                  <span className={cn('mt-2 h-2 w-2 flex-none rounded-full', item.read ? 'bg-transparent' : 'bg-primary')} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className={cn('truncate text-sm', item.read ? 'font-medium text-foreground' : 'font-semibold text-foreground')}>
                        {item.from.name}
                      </span>
                      <span className="flex-none text-xs tabular-nums text-muted-foreground">{when(item.receivedAt, locale)}</span>
                    </span>
                    <span className="block truncate text-sm text-foreground">{item.subject}</span>
                    <span className="block truncate text-xs text-muted-foreground">{item.preview}</span>
                    <span className="mt-1 flex items-center gap-1.5">
                      <Badge variant={categoryTone[item.category] ?? 'muted'}>{item.category}</Badge>
                      {item.needsReply && !item.replied ? <Badge variant="warning">{t('inbox.needsReply')}</Badge> : null}
                      {item.replied ? <Badge variant="success">{t('inbox.replied')}</Badge> : null}
                      {item.flagged ? <Flag className="h-3.5 w-3.5 text-warning" /> : null}
                      {item.attachments.length ? <Paperclip className="h-3.5 w-3.5 text-muted-foreground" /> : null}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>

        {/* Detail */}
        <Card className="min-h-[60vh] p-5">
          {!openId ? <EmptyState title={t('inbox.select')} message={t('inbox.selectDetail')} /> : null}
          {openId && detail.isLoading ? <LoadingRows rows={8} /> : null}
          {m ? (
            <div className="flex flex-col gap-4">
              <div>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h2 className="text-lg font-semibold text-foreground">{m.subject}</h2>
                  <div className="flex items-center gap-1.5">
                    <Button variant="secondary" size="sm" onClick={() => flag.mutate(m)} title={m.flagged ? t('inbox.removeFlag') : t('inbox.flag')}>
                      <Flag className={cn(m.flagged && 'fill-warning text-warning')} /> {m.flagged ? t('inbox.flagged') : t('inbox.flag')}
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => toTask.mutate(m)} disabled={toTask.isPending}>
                      <CheckSquare /> {toTask.isSuccess ? t('inbox.taskAdded') : t('inbox.makeTask')}
                    </Button>
                  </div>
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">{m.from.name}</span> &lt;{m.from.email}&gt; ·{' '}
                  {new Date(m.receivedAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {t('inbox.to')}: {m.to.join(', ')}
                </div>
              </div>

              <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{m.body}</div>

              {m.attachments.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {m.attachments.map((a) => (
                    <span key={a.name} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-foreground">
                      <Paperclip className="h-3 w-3" /> {a.name} <span className="text-muted-foreground">({Math.round(a.size / 1024)} KB)</span>
                    </span>
                  ))}
                </div>
              ) : null}

              {sent ? <Banner title={sent} tone="info" /> : null}

              {/* Reply */}
              <div className="border-t border-border pt-4">
                {draft === null ? (
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => makeDraft.mutate(m.id)} disabled={makeDraft.isPending}>
                      <Sparkles /> {makeDraft.isPending ? t('inbox.drafting') : t('inbox.draft')}
                    </Button>
                    <Button variant="secondary" onClick={() => setDraft('')}>
                      <Reply /> {t('inbox.writeOwn')}
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('inbox.replyTo', { name: m.from.name })}</div>
                    <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={8} placeholder={t('inbox.replyPlaceholder')} />
                    {!confirming ? (
                      <div className="flex flex-wrap gap-2">
                        <Button onClick={() => setConfirming(true)} disabled={!draft.trim()}>
                          <Send /> {t('inbox.send')}
                        </Button>
                        <Button variant="secondary" onClick={() => makeDraft.mutate(m.id)} disabled={makeDraft.isPending}>
                          <Sparkles /> {t('inbox.redraft')}
                        </Button>
                        <Button variant="secondary" onClick={() => setDraft(null)}>
                          {t('inbox.cancel')}
                        </Button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/50 bg-warning/10 px-3 py-2">
                        <span className="text-sm text-foreground">{t('inbox.confirm', { email: m.from.email })}</span>
                        <Button size="sm" onClick={() => send.mutate({ id: m.id, body: draft })} disabled={send.isPending}>
                          {send.isPending ? t('inbox.sending') : t('inbox.yesSend')}
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => setConfirming(false)}>
                          {t('inbox.no')}
                        </Button>
                      </div>
                    )}
                    {send.isError ? <p className="text-sm text-destructive">{(send.error as Error).message}</p> : null}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
