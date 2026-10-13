import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckSquare,
  Square,
  Plus,
  Trash2,
  Volume2,
  VolumeX,
  RefreshCw,
  ArrowUpRight,
  CalendarDays,
  Mail,
  Factory,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn, formatTime } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ErrorState, LoadingRows } from '@/components/states';
import { useI18n } from '@/lib/i18n';
import type { BriefingSection, TaskItem } from '@/lib/types';

const severityDot: Record<string, string> = {
  critical: 'bg-destructive',
  warning: 'bg-warning',
  info: 'bg-primary',
};

// Icon and accent per briefing section, so each card reads at a glance.
const SECTION_META: Record<string, { icon: LucideIcon; chip: string }> = {
  mail: { icon: Mail, chip: 'bg-primary/10 text-primary' },
  production: { icon: Factory, chip: 'bg-warning/10 text-warning' },
  maintenance: { icon: Wrench, chip: 'bg-primary/10 text-primary' },
  calendar: { icon: CalendarDays, chip: 'bg-primary/10 text-primary' },
  tasks: { icon: CheckSquare, chip: 'bg-primary/10 text-primary' },
};

/** The left edge of a card is tinted by its most severe item. */
const accentBorder = (section: BriefingSection): string => {
  const sev = section.items.map((i) => i.severity);
  if (sev.includes('critical')) return 'border-l-2 border-l-destructive';
  if (sev.includes('warning')) return 'border-l-2 border-l-warning';
  return '';
};

/** Reads a short text aloud with the browser voice; used for the briefing. */
function useSpeaker() {
  const [speaking, setSpeaking] = useState(false);
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const stop = () => {
    if (supported) window.speechSynthesis.cancel();
    setSpeaking(false);
  };
  const speak = (text: string, lang = 'en-GB') => {
    if (!supported || !text) return;
    stop();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = 0.95;
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(u);
  };
  return { supported, speaking, speak, stop };
}

function SectionCard({ section, onGo, empty, className }: { section: BriefingSection; onGo: (href: string) => void; empty: string; className?: string }) {
  const meta = SECTION_META[section.id] ?? { icon: CalendarDays, chip: 'bg-primary/10 text-primary' };
  const Icon = meta.icon;
  return (
    <Card className={cn('flex flex-col p-5', accentBorder(section), className)}>
      <div className="flex items-center gap-3">
        <span className={cn('grid h-9 w-9 flex-none place-items-center rounded-lg', meta.chip)}>
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{section.title}</div>
          <div className="line-clamp-2 text-sm font-semibold text-foreground">{section.headline}</div>
        </div>
      </div>
      {section.items.length > 0 ? (
        <ul className="mt-3 flex flex-col divide-y divide-border/60">
          {section.items.map((it, i) => {
            const row = (
              <>
                <span className={cn('mt-1.5 h-1.5 w-1.5 flex-none rounded-full', severityDot[it.severity ?? 'info'])} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-foreground">{it.label}</span>
                  <span className="block text-xs text-muted-foreground">{it.detail}</span>
                </span>
                {it.href ? <ArrowUpRight className="h-4 w-4 flex-none text-muted-foreground transition-transform group-hover/row:translate-x-0.5" /> : null}
              </>
            );
            return it.href ? (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => onGo(it.href!)}
                  className="group/row -mx-2 flex w-[calc(100%+1rem)] items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-secondary/50"
                >
                  {row}
                </button>
              </li>
            ) : (
              <li key={i} className="flex items-start gap-2.5 py-2">
                {row}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">{empty}</p>
      )}
    </Card>
  );
}

function TaskRow({
  task,
  onToggle,
  onDelete,
  labels,
  locale,
}: {
  task: TaskItem;
  onToggle: () => void;
  onDelete: () => void;
  labels: { done: string; open: string; del: string };
  locale: string;
}) {
  const overdue = task.status === 'open' && task.dueAt && new Date(task.dueAt).getTime() < Date.now();
  return (
    <li className="group flex items-center gap-2.5 rounded-md px-1 py-1.5 hover:bg-secondary/50">
      <button
        type="button"
        onClick={onToggle}
        aria-label={task.status === 'done' ? labels.open : labels.done}
        className="flex-none text-muted-foreground hover:text-foreground"
      >
        {task.status === 'done' ? <CheckSquare className="h-[18px] w-[18px] text-success" /> : <Square className="h-[18px] w-[18px]" />}
      </button>
      <span className={cn('min-w-0 flex-1 truncate text-sm', task.status === 'done' ? 'text-muted-foreground line-through' : 'text-foreground')}>
        {task.title}
      </span>
      {task.dueAt ? (
        <span className={cn('flex-none text-xs tabular-nums', overdue ? 'font-semibold text-destructive' : 'text-muted-foreground')}>
          {new Date(task.dueAt).toLocaleString(locale, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
        </span>
      ) : null}
      <button
        type="button"
        onClick={onDelete}
        aria-label={labels.del}
        className="flex-none text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </li>
  );
}

export function TodayPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const speaker = useSpeaker();
  const { t, language, locale, speechLocale } = useI18n();
  const taskLabels = { done: t('today.markDone'), open: t('today.markOpen'), del: t('today.delete') };

  const briefing = useQuery({ queryKey: ['briefing', language], queryFn: () => api.briefing(language) });
  const calendar = useQuery({ queryKey: ['calendar', 'today'], queryFn: () => api.calendar('today') });
  const tasks = useQuery({ queryKey: ['tasks', 'all'], queryFn: () => api.tasks('all'), select: (d) => d.items });

  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['tasks'] });
    void qc.invalidateQueries({ queryKey: ['briefing'] });
  };
  const create = useMutation({
    mutationFn: () => api.createTask({ title: title.trim(), dueAt: due ? new Date(due).toISOString() : null }),
    onSuccess: () => {
      setTitle('');
      setDue('');
      invalidate();
    },
  });
  const toggle = useMutation({
    mutationFn: (t: TaskItem) => api.updateTask(t.id, { status: t.status === 'done' ? 'open' : 'done' }),
    onSuccess: invalidate,
  });
  const remove = useMutation({ mutationFn: (id: string) => api.deleteTask(id), onSuccess: invalidate });

  const go = (href: string) => {
    if (/^https?:/i.test(href)) window.open(href, '_blank', 'noreferrer');
    else navigate(href);
  };

  const open = (tasks.data ?? []).filter((t) => t.status === 'open');
  const done = (tasks.data ?? []).filter((t) => t.status === 'done');

  return (
    <div>
      <PageHeader
        title={t('today.title')}
        description={
          briefing.data
            ? `${briefing.data.greeting} · ${new Date(briefing.data.date).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })}`
            : 'Your daily briefing, calendar and tasks in one place.'
        }
      >
        <Button variant="secondary" size="sm" onClick={() => void briefing.refetch()} title={t('today.refresh')}>
          <RefreshCw className={cn(briefing.isFetching && 'animate-spin')} /> {t('today.refresh')}
        </Button>
        {speaker.supported ? (
          speaker.speaking ? (
            <Button size="sm" onClick={speaker.stop}>
              <VolumeX /> {t('today.stop')}
            </Button>
          ) : (
            <Button size="sm" disabled={!briefing.data} onClick={() => briefing.data && speaker.speak(briefing.data.spoken, speechLocale)}>
              <Volume2 /> {t('today.read')}
            </Button>
          )
        ) : null}
      </PageHeader>

      {briefing.isError ? <ErrorState message={(briefing.error as Error).message} onRetry={() => void briefing.refetch()} /> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Briefing: what needs attention. Calendar and tasks live in the right
            rail where they are interactive, so they are left out here. */}
        <div className="flex flex-col gap-4 lg:col-span-2">
          {briefing.isLoading ? (
            <Card className="p-5">
              <LoadingRows rows={6} />
            </Card>
          ) : null}
          {briefing.data
            ? (() => {
                const sections = briefing.data.sections.filter((s) => s.id !== 'calendar' && s.id !== 'tasks');
                const mail = sections.find((s) => s.id === 'mail');
                const rest = sections.filter((s) => s.id !== 'mail');
                return (
                  <>
                    {mail ? <SectionCard section={mail} onGo={go} empty={t('today.nothing')} /> : null}
                    {rest.length > 0 ? (
                      <div className="grid gap-4 md:grid-cols-2">
                        {rest.map((s) => (
                          <SectionCard key={s.id} section={s} onGo={go} empty={t('today.nothing')} />
                        ))}
                      </div>
                    ) : null}
                  </>
                );
              })()
            : null}
        </div>

        {/* Right rail: the interactive calendar and tasks. */}
        <div className="flex flex-col gap-4">
          <Button variant="secondary" onClick={() => navigate('/inbox?filter=needsReply')}>
            <Mail /> {t('today.needsReply')}
          </Button>

          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                <CalendarDays className="h-4 w-4" /> {t('today.calendar')}
              </h2>
              <span className="text-xs text-muted-foreground">
                {briefing.data ? new Date(briefing.data.date).toLocaleDateString(locale, { day: '2-digit', month: 'short' }) : ''}
              </span>
            </div>
            {calendar.isLoading ? <LoadingRows rows={3} /> : null}
            {calendar.data && calendar.data.items.length === 0 ? <p className="text-sm text-muted-foreground">{t('today.noMeetings')}</p> : null}
            <ul className="flex flex-col gap-2.5">
              {calendar.data?.items.map((e) => (
                <li key={e.id} className="flex gap-3">
                  <div className="flex w-12 flex-none flex-col items-end pt-0.5 text-right">
                    <span className="text-xs font-semibold tabular-nums text-foreground">{formatTime(e.startsAt)}</span>
                    <span className="text-[10px] tabular-nums text-muted-foreground">{formatTime(e.endsAt)}</span>
                  </div>
                  <div className="relative min-w-0 flex-1 border-l-2 border-primary/40 pl-3">
                    <span className="block text-sm font-medium text-foreground">{e.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {e.isOnline ? t('today.online') : e.location}
                      {e.attendees.length ? ` · ${t('today.attendees', { count: e.attendees.length })}` : ''}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                <CheckSquare className="h-4 w-4" /> {t('today.tasks')}
              </h2>
              <span className="text-xs text-muted-foreground">{t('today.open', { count: open.length })}</span>
            </div>
            <form
              className="mb-3 flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (title.trim()) create.mutate();
              }}
            >
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('today.addPlaceholder')} />
              <div className="flex items-center gap-2">
                <Input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} className="h-9 flex-1" aria-label={t('today.due')} />
                <Button type="submit" size="sm" disabled={!title.trim() || create.isPending}>
                  <Plus /> {t('today.add')}
                </Button>
              </div>
            </form>
            {tasks.isLoading ? <LoadingRows rows={3} /> : null}
            {tasks.data && tasks.data.length === 0 ? <p className="text-sm text-muted-foreground">{t('today.empty')}</p> : null}
            <ul className="flex flex-col">
              {open.map((item) => (
                <TaskRow
                  key={item.id}
                  task={item}
                  onToggle={() => toggle.mutate(item)}
                  onDelete={() => remove.mutate(item.id)}
                  labels={taskLabels}
                  locale={locale}
                />
              ))}
            </ul>
            {done.length > 0 ? (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs font-medium text-muted-foreground">{t('today.completed', { count: done.length })}</summary>
                <ul className="mt-1 flex flex-col">
                  {done.map((item) => (
                    <TaskRow
                      key={item.id}
                      task={item}
                      onToggle={() => toggle.mutate(item)}
                      onDelete={() => remove.mutate(item.id)}
                      labels={taskLabels}
                      locale={locale}
                    />
                  ))}
                </ul>
              </details>
            ) : null}
          </Card>
        </div>
      </div>
    </div>
  );
}
