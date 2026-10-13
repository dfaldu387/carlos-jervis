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
import { useT } from '@/lib/i18n';

const SHIFTS = [
  { id: 'S1', name: 'reports.shift.S1', window: '06:00–14:00' },
  { id: 'S2', name: 'reports.shift.S2', window: '14:00–22:00' },
  { id: 'S3', name: 'reports.shift.S3', window: '22:00–06:00' },
];

interface Report {
  id: string;
  label: string;
  date: string;
  at: string;
  result: AskResult;
}

export function ReportsPage() {
  const t = useT();
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
        label: scope === 'shift' ? t(SHIFTS.find((s) => s.id === shift)!.name) : t('reports.fullDay'),
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
    const text = [
      a.headline,
      '',
      ...(a.narrative ?? []),
      '',
      `${t('reports.sourcesLabel')}: ` + (report.result.sources ?? []).map((s) => s.label).join(', '),
    ].join('\n');
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
      <PageHeader title={t('reports.title')} description={t('reports.description')} />
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <div className="flex flex-col gap-4">
          <Card className="p-5">
            <h2 className="mb-3 text-base font-semibold text-foreground">{t('reports.generate')}</h2>
            <div className="flex flex-col gap-3">
              <div>
                <Label htmlFor="d">{t('reports.date')}</Label>
                <Input id="d" type="date" className="mt-1" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div>
                <Label>{t('reports.scope')}</Label>
                <div className="mt-1 inline-flex overflow-hidden rounded-md border border-input">
                  <button
                    type="button"
                    onClick={() => setScope('shift')}
                    className={`px-3 py-1.5 text-sm ${scope === 'shift' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-secondary'}`}
                  >
                    {t('reports.oneShift')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setScope('day')}
                    className={`px-3 py-1.5 text-sm ${scope === 'day' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-secondary'}`}
                  >
                    {t('reports.fullDay')}
                  </button>
                </div>
              </div>
              {scope === 'shift' ? (
                <div>
                  <Label htmlFor="sh">{t('reports.shift')}</Label>
                  <Select id="sh" className="mt-1" value={shift} onChange={(e) => setShift(e.target.value)}>
                    {SHIFTS.map((s) => (
                      <option key={s.id} value={s.id}>
                        {t(s.name)} ({s.window})
                      </option>
                    ))}
                  </Select>
                </div>
              ) : null}
              <Button onClick={generate} disabled={busy}>
                {busy ? t('reports.generating') : t('reports.generateBtn')}
              </Button>
            </div>
          </Card>

          {history.length ? (
            <Card className="p-5">
              <h2 className="mb-2 text-base font-semibold text-foreground">{t('reports.history')}</h2>
              <div className="flex flex-col gap-2">
                {history.map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => setReport(h)}
                    className="flex items-center gap-2.5 rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-secondary/50"
                  >
                    <FileText className="h-4 w-4 flex-none text-primary" />
                    <span className="min-w-0">
                      <span className="block font-semibold text-foreground">
                        {h.label} · {h.date}
                      </span>
                      <span className="text-xs text-muted-foreground">{t('reports.generatedAt', { time: formatTime(h.at) })}</span>
                    </span>
                  </button>
                ))}
              </div>
            </Card>
          ) : null}
        </div>

        <div className="flex flex-col gap-4">
          <Banner tone="warning" title={t('reports.demo')}>
            {t('reports.demoBody', { wording: report?.result.answer.provider === 'claude' ? t('reports.wording.ai') : t('reports.wording.template') })}
          </Banner>
          {error ? <ErrorState message={error} onRetry={generate} /> : null}
          {busy ? (
            <Card className="p-5">
              <LoadingRows rows={8} />
            </Card>
          ) : null}
          {!report && !busy && !error ? <EmptyState title={t('reports.noneTitle')} message={t('reports.noneBody')} /> : null}
          {report && !busy ? (
            <>
              <div className="flex justify-end">
                <Button variant="secondary" size="sm" onClick={copy}>
                  {copied ? (
                    <>
                      <Check /> {t('reports.copied')}
                    </>
                  ) : (
                    <>
                      <Copy /> {t('reports.copy')}
                    </>
                  )}
                </Button>
              </div>
              <AnswerCard result={report.result} />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
