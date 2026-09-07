'use client';
import { useState, useCallback, Fragment } from 'react';
import { reports } from '@/lib/api';
import toast from 'react-hot-toast';
import { Wallet, RefreshCw, Printer, ChevronRight, ChevronDown } from 'lucide-react';
import { formatCurrency } from '@/lib/auth';
import { printDocument, phpFmt, dateFmt } from '@/lib/print';

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => `${new Date().toISOString().slice(0, 7)}-01`;

const fmt = (n) => formatCurrency(Number(n || 0));
const signed = (n) => (Number(n) < 0 ? 'text-red-600' : 'text-gray-900');

// One account's cashbook table, with lazily-loaded per-day drill-down.
function AccountCashbook({ account }) {
  const [openDate, setOpenDate] = useState(null);
  const [detail,   setDetail]   = useState({});   // date → lines[]
  const [loading,  setLoading]  = useState(null);

  const toggle = async (date) => {
    if (openDate === date) { setOpenDate(null); return; }
    setOpenDate(date);
    if (detail[date]) return;
    setLoading(date);
    try {
      const res = await reports.cashPosition.day({ date, accountCode: account.accountCode });
      setDetail((d) => ({ ...d, [date]: res.data.lines }));
    } catch {
      toast.error('Could not load that day');
      setOpenDate(null);
    } finally {
      // Only clear the indicator if it's still ours — a slower, earlier
      // request resolving after a newer one started must not clear it.
      setLoading((current) => (current === date ? null : current));
    }
  };

  return (
    <div className="card mb-4">
      <div className="card-body">
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="font-semibold text-gray-800">
            <span className="font-mono text-xs text-gray-400 mr-2">{account.accountCode}</span>
            {account.accountName}
          </h3>
          <span className={`text-lg font-bold ${signed(account.closing)}`}>{fmt(account.closing)}</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-xs text-gray-500">
                <th className="text-left">Date</th>
                <th className="text-right">Beginning</th>
                <th className="text-right">In</th>
                <th className="text-right">Out</th>
                <th className="text-right">Ending</th>
              </tr>
            </thead>
            <tbody>
              <tr className="text-sm text-gray-500 italic">
                <td>Opening balance</td>
                <td colSpan={3}></td>
                <td className={`text-right font-mono ${signed(account.opening)}`}>{fmt(account.opening)}</td>
              </tr>

              {account.rows.length === 0 && (
                <tr><td colSpan={5} className="text-center text-gray-400 py-6">No cash movement in this range</td></tr>
              )}

              {account.rows.map((r) => (
                <Fragment key={r.date}>
                  <tr onClick={() => toggle(r.date)} className="hover:bg-gray-50/50 cursor-pointer text-sm">
                    <td className="flex items-center gap-1">
                      {openDate === r.date ? <ChevronDown className="w-3 h-3 text-gray-400" /> : <ChevronRight className="w-3 h-3 text-gray-400" />}
                      {dateFmt(r.date)}
                    </td>
                    <td className={`text-right font-mono ${signed(r.begin)}`}>{fmt(r.begin)}</td>
                    <td className="text-right font-mono text-green-700">{r.in ? fmt(r.in) : <span className="text-gray-200">—</span>}</td>
                    <td className="text-right font-mono text-red-700">{r.out ? fmt(r.out) : <span className="text-gray-200">—</span>}</td>
                    <td className={`text-right font-mono font-medium ${signed(r.ending)}`}>{fmt(r.ending)}</td>
                  </tr>

                  {openDate === r.date && (
                    <tr>
                      <td colSpan={5} className="bg-gray-50 p-0">
                        {loading === r.date ? (
                          <div className="p-4 text-center text-gray-400 text-sm">Loading…</div>
                        ) : (
                          <table className="w-full text-xs">
                            <tbody>
                              {(detail[r.date] || []).map((l, i) => (
                                <tr key={i}>
                                  <td className="pl-8 font-mono text-gray-400">{l.entryNo}</td>
                                  <td className="text-gray-600">{l.reference || '—'}</td>
                                  <td className="text-gray-700">{l.description}</td>
                                  <td className="text-right font-mono text-green-700">{l.in ? fmt(l.in) : ''}</td>
                                  <td className="text-right font-mono text-red-700 pr-4">{l.out ? fmt(l.out) : ''}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}

              <tr className="font-semibold border-t text-sm">
                <td>Total</td>
                <td></td>
                <td className="text-right font-mono text-green-700">{fmt(account.totalIn)}</td>
                <td className="text-right font-mono text-red-700">{fmt(account.totalOut)}</td>
                <td className={`text-right font-mono ${signed(account.closing)}`}>{fmt(account.closing)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function CashPositionPage() {
  const [from, setFrom]   = useState(monthStart());
  const [to,   setTo]     = useState(today());
  const [accountCode, setAccountCode] = useState('');
  const [accountOptions, setAccountOptions] = useState([]);
  const [data, setData]   = useState(null);
  const [busy, setBusy]   = useState(false);

  const generate = useCallback(async () => {
    setBusy(true);
    try {
      const res = await reports.cashPosition.report({ from, to, ...(accountCode ? { accountCode } : {}) });
      setData(res.data);
      // Only an unfiltered fetch carries the full account list — a narrower,
      // single-account response must not collapse the selector's options.
      if (!accountCode) {
        setAccountOptions(res.data.accounts.map((a) => ({ code: a.accountCode, name: a.accountName })));
      }
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Could not generate the report');
    } finally { setBusy(false); }
  }, [from, to, accountCode]);

  const print = () => {
    if (!data) return;
    const body = data.accounts.map((a) => `
      <h3>${a.accountCode} — ${a.accountName}</h3>
      <table style="width:100%;border-collapse:collapse" border="1" cellpadding="4">
        <tr><th>Date</th><th>Beginning</th><th>In</th><th>Out</th><th>Ending</th></tr>
        <tr><td colspan="4">Opening balance</td><td align="right">${phpFmt(a.opening)}</td></tr>
        ${a.rows.map((r) => `<tr>
          <td>${dateFmt(r.date)}</td>
          <td align="right">${phpFmt(r.begin)}</td>
          <td align="right">${phpFmt(r.in)}</td>
          <td align="right">${phpFmt(r.out)}</td>
          <td align="right">${phpFmt(r.ending)}</td>
        </tr>`).join('')}
        <tr><td><b>Total</b></td><td></td>
          <td align="right"><b>${phpFmt(a.totalIn)}</b></td>
          <td align="right"><b>${phpFmt(a.totalOut)}</b></td>
          <td align="right"><b>${phpFmt(a.closing)}</b></td></tr>
      </table>`).join('');
    printDocument('Cash Position Report', `${dateFmt(data.from)} — ${dateFmt(data.to)}`, body);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Cash Position</h1>
          <p className="page-subtitle">Running balance per day for every cash account</p>
        </div>
        {data && (
          <button className="btn-secondary" onClick={print}>
            <Printer className="w-4 h-4" /> Print
          </button>
        )}
      </div>

      <div className="card mb-4">
        <div className="card-body flex flex-wrap items-end gap-3">
          <div>
            <label className="label">From</label>
            <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="label">To</label>
            <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <label className="label">Account</label>
            <select className="input" value={accountCode} onChange={(e) => setAccountCode(e.target.value)}>
              <option value="">All cash accounts</option>
              {accountOptions.map((a) => (
                <option key={a.code} value={a.code}>{a.code} — {a.name}</option>
              ))}
            </select>
          </div>
          <button className="btn-primary" onClick={generate} disabled={busy}>
            <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} />
            {busy ? 'Generating…' : 'Generate'}
          </button>
        </div>
      </div>

      {!data && (
        <div className="card">
          <div className="p-16 text-center">
            <Wallet className="w-12 h-12 mx-auto text-gray-300 mb-3" />
            <p className="text-gray-500">Pick a date range and click <strong>Generate</strong>.</p>
          </div>
        </div>
      )}

      {data?.accounts.length === 0 && (
        <div className="card"><div className="p-16 text-center text-gray-500">No cash accounts found.</div></div>
      )}

      {data?.accounts.map((a) => (
        <AccountCashbook key={a.accountCode} account={a} />
      ))}
    </div>
  );
}
