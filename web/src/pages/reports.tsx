import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy, Check, FileText } from 'lucide-react';
import { api } from '@/lib/api';
import { formatTime } from '@/lib/utils';
import { PageHeader } from '@/components/page-header';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Banner, EmptyState, ErrorState, LoadingRows } from '@/components/states';
import { AnswerCard } from '@/components/answer-card';
import type { AskResult } from '@/lib/types';

const SHIFTS = [
  { id: 'S1', name: 'Early shift', window: '06:00–14:00' },
  { id: 'S2', name: 'Late shift', window: '14:00–22:00' },
  { id: 'S3', name: 'Night shift', window: '22:00–06:00' },
];

interface Report {
  id: string;
  label: string;
  date: string;
  at: string;
  result: AskResult;
}

export function ReportsPage() {
  const health = useQuery({ queryKey: ['health'], queryFn: () => api.health() });
  const [date, setDate] = useState('');
  const [scope, setScope] = useState<'shift' | 'day'>('shift');
  const [shift, setShift] = useState('S1');
  const [report, setReport] = useState<Report | null>(null);
  const [history, setHistory] = useState<Report[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refDate = date || health.data?.dataset?.referenceDate || '';

  const generate = async () => {
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const result = scope === 'shift' ? await api.shiftSummary({ date: refDate, shift }) : await api.dailySummary({ date: refDate });
      const entry: Report = {
        id: `${scope}-${shift}-${refDate}-${Date.now()}`,
        label: scope === 'shift' ? SHIFTS.find((s) => s.id === shift)!.name : 'Full day',
        date: refDate,
        at: new Date().toISOString(),
        result,
      };
      setReport(entry);
      setHistory((prev) => [entry, ...prev].slice(0, 6));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!report) return;
    const a = report.result.answer;
    const text = [a.headline, '', ...(a.narrative ?? []), '', 'Sources: ' + (report.result.sources ?? []).map((s) => s.label).join(', ')].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <div>
      <PageHeader title="Shift Reports" description="Review operational activity and prepare shift handovers." />
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <div className="flex flex-col gap-4">
          <Card className="p-5">
            <h2 className="mb-3 text-base font-semibold text-foreground">Generate a report</h2>
            <div className="flex flex-col gap-3">
              <div><Label htmlFor="d">Report date</Label><Input id="d" type="date" className="mt-1" value={date} onChange={(e) => setDate(e.target.value)} /></div>
              <div>
                <Label>Scope</Label>
                <div className="mt-1 inline-flex overflow-hidden rounded-md border border-input">
                  <button type="button" onClick={() => setScope('shift')} className={`px-3 py-1.5 text-sm ${scope === 'shift' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-secondary'}`}>One shift</button>
                  <button type="button" onClick={() => setScope('day')} className={`px-3 py-1.5 text-sm ${scope === 'day' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-secondary'}`}>Full day</button>
                </div>
              </div>
              {scope === 'shift' ? (
                <div>
                  <Label htmlFor="sh">Shift</Label>
                  <Select id="sh" className="mt-1" value={shift} onChange={(e) => setShift(e.target.value)}>
                    {SHIFTS.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.window})</option>)}
                  </Select>
                </div>
              ) : null}
              <Button onClick={generate} disabled={busy}>{busy ? 'Generating…' : 'Generate report'}</Button>
            </div>
          </Card>

          {history.length ? (
            <Card className="p-5">
              <h2 className="mb-2 text-base font-semibold text-foreground">Report history</h2>
              <div className="flex flex-col gap-2">
                {history.map((h) => (
                  <button key={h.id} type="button" onClick={() => setReport(h)} className="flex items-center gap-2.5 rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-secondary/50">
                    <FileText className="h-4 w-4 flex-none text-primary" />
                    <span className="min-w-0">
                      <span className="block font-semibold text-foreground">{h.label} · {h.date}</span>
                      <span className="text-xs text-muted-foreground">Generated {formatTime(h.at)}</span>
                    </span>
                  </button>
                ))}
              </div>
            </Card>
          ) : null}
        </div>

        <div className="flex flex-col gap-4">
          <Banner tone="warning" title="Demo data">
            Reports use synthetic data. Figures are retrieved facts; the narrative wording is{' '}
            {report?.result.answer.provider === 'claude' ? 'AI-generated interpretation.' : 'composed from deterministic templates.'}
          </Banner>
          {error ? <ErrorState message={error} onRetry={generate} /> : null}
          {busy ? <Card className="p-5"><LoadingRows rows={8} /></Card> : null}
          {!report && !busy && !error ? <EmptyState title="No report yet" message="Choose a date and shift, then generate a report." /> : null}
          {report && !busy ? (
            <>
              <div className="flex justify-end">
                <Button variant="secondary" size="sm" onClick={copy}>{copied ? <><Check /> Copied</> : <><Copy /> Copy report</>}</Button>
              </div>
              <AnswerCard result={report.result} />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
