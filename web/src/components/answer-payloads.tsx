import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { ArrowUpRight, CalendarDays, CheckSquare, ExternalLink, LayoutGrid, Mail, Square, Workflow } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { formatTime } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { useI18n, useT } from '@/lib/i18n';
import type { AskResult, AutomationProposal } from '@/lib/types';

const severityDot: Record<string, string> = {
  critical: 'bg-destructive',
  warning: 'bg-warning',
  info: 'bg-primary',
};

function SectionTitle({ icon: Icon, children }: { icon: typeof Mail; children: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      <Icon className="h-3.5 w-3.5" /> {children}
    </div>
  );
}

/**
 * A Power Automate flow Jervis proposes. Nothing runs until the user presses
 * the button; the server refuses the trigger without that confirmation.
 */
function FlowProposal({ proposal }: { proposal: AutomationProposal }) {
  const t = useT();
  const [dismissed, setDismissed] = useState(false);
  const run = useMutation({ mutationFn: () => api.triggerFlow({ flow: proposal.flow, payload: proposal.payload }) });
  if (dismissed) return null;
  return (
    <div className="rounded-lg border border-primary/40 bg-primary/5 p-3">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary">
        <Workflow className="h-3.5 w-3.5" /> {t('answer.flow')}
      </div>
      <div className="mt-1 text-sm font-medium text-foreground">{proposal.label}</div>
      {Object.keys(proposal.payload).length > 0 ? (
        <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          {Object.entries(proposal.payload).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="font-medium">{k}</dt>
              <dd className="truncate">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {run.isSuccess ? (
          <span className="text-sm text-success">{run.data.mode === 'simulated' ? t('answer.flowSimulated') : t('answer.flowDone')}</span>
        ) : (
          <>
            <Button size="sm" onClick={() => run.mutate()} disabled={run.isPending}>
              {run.isPending ? t('answer.flowRunning') : t('answer.flowRun')}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setDismissed(true)}>
              {t('answer.flowCancel')}
            </Button>
          </>
        )}
        {run.isError ? <span className="text-sm text-destructive">{(run.error as Error).message}</span> : null}
      </div>
    </div>
  );
}

/**
 * Structured payloads that the secretary tools attach to an answer: mail,
 * calendar, tasks, a briefing, a created dashboard, or a Power BI measure.
 * Each block links to the page where the user can act on it.
 */
export function AnswerPayloads({ result }: { result: AskResult }) {
  const { mail, events, tasks, briefing, dashboard, measure, automation } = result;
  const t = useT();
  const { locale } = useI18n();
  if (!mail && !events && !tasks && !briefing && !dashboard && !measure && !automation) return null;

  return (
    <div className="mt-4 flex flex-col gap-4">
      {measure ? (
        <div className="rounded-lg border border-border bg-secondary/30 p-3">
          <div className="text-xs font-medium text-muted-foreground">{measure.name}</div>
          <div className="mt-0.5 text-2xl font-bold tabular-nums text-foreground">
            {measure.value.toLocaleString(locale)}
            {measure.unit ? <span className="ml-1 text-base font-medium text-muted-foreground">{measure.unit}</span> : null}
          </div>
          {measure.report ? (
            <div className="mt-1 text-xs text-muted-foreground">
              {measure.report}
              {measure.url ? (
                <a href={measure.url} target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center gap-0.5 text-primary">
                  {t('answer.openReport')} <ExternalLink className="h-3 w-3" />
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {mail && mail.items.length > 0 ? (
        <div>
          <SectionTitle icon={Mail}>{t('answer.mail')}</SectionTitle>
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {mail.items.slice(0, 6).map((m) => (
              <li key={m.id}>
                <Link to={`/inbox?open=${encodeURIComponent(m.id)}`} className="flex items-start gap-3 px-3 py-2 transition-colors hover:bg-secondary/50">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`truncate text-sm ${m.read ? 'font-medium text-foreground' : 'font-semibold text-foreground'}`}>{m.subject}</span>
                      {m.needsReply && !m.replied ? <Badge variant="muted">{t('answer.needsReply')}</Badge> : null}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {m.from.name} · {m.preview}
                    </div>
                  </div>
                  <ArrowUpRight className="h-4 w-4 flex-none text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {events && events.items.length > 0 ? (
        <div>
          <SectionTitle icon={CalendarDays}>
            {t('answer.calendar')}
            {events.day ? ` · ${events.day}` : ''}
          </SectionTitle>
          <ul className="flex flex-col gap-1.5">
            {events.items.map((e) => (
              <li key={e.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm">
                <span className="w-24 flex-none tabular-nums text-muted-foreground">
                  {formatTime(e.startsAt)}–{formatTime(e.endsAt)}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">{e.title}</span>
                <span className="truncate text-xs text-muted-foreground">{e.isOnline ? 'Online' : e.location}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {tasks && tasks.items.length > 0 ? (
        <div>
          <SectionTitle icon={CheckSquare}>{t('answer.tasks')}</SectionTitle>
          <ul className="flex flex-col gap-1.5">
            {tasks.items.map((t) => (
              <li key={t.id} className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2 text-sm">
                {t.status === 'done' ? <CheckSquare className="h-4 w-4 text-success" /> : <Square className="h-4 w-4 text-muted-foreground" />}
                <span className="min-w-0 flex-1 truncate text-foreground">{t.title}</span>
                {t.dueAt ? (
                  <span className="text-xs text-muted-foreground">{new Date(t.dueAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}</span>
                ) : null}
              </li>
            ))}
          </ul>
          <Link to="/today" className="mt-1.5 inline-block text-xs font-medium text-primary hover:underline">
            {t('answer.openToday')}
          </Link>
        </div>
      ) : null}

      {briefing ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {briefing.sections.map((s) => (
            <div key={s.id} className="rounded-lg border border-border p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{s.title}</div>
              <div className="mt-0.5 text-sm font-medium text-foreground">{s.headline}</div>
              <ul className="mt-2 flex flex-col gap-1">
                {s.items.slice(0, 4).map((it, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs">
                    <span className={`mt-1.5 h-1.5 w-1.5 flex-none rounded-full ${severityDot[it.severity ?? 'info']}`} />
                    <span className="min-w-0">
                      <span className="font-medium text-foreground">{it.label}</span>
                      <span className="text-muted-foreground"> · {it.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}

      {automation ? <FlowProposal proposal={automation} /> : null}

      {dashboard ? (
        <Link
          to={`/dashboards/${dashboard.id}`}
          className="flex items-center gap-3 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2.5 transition-colors hover:bg-primary/10"
        >
          <span className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-primary/10 text-primary">
            <LayoutGrid className="h-[18px] w-[18px]" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-foreground">{dashboard.title}</span>
            <span className="block text-xs text-muted-foreground">
              {t('answer.widgets', { count: dashboard.widgets.length })} · {dashboard.period.label}
            </span>
          </span>
          <span className="text-xs font-medium text-primary">{t('answer.openDashboard')}</span>
        </Link>
      ) : null}
    </div>
  );
}
