'use client';
import { useState, useEffect, useCallback } from 'react';
import { inventory as inventoryApi } from '@/lib/api';
import { printDocument, phpFmt, dateFmt } from '@/lib/print';
import toast from 'react-hot-toast';
import {
  BarChart2, AlertTriangle, TrendingUp, RefreshCw,
  Printer, FileText, Package, ArrowUpCircle, ArrowDownCircle,
} from 'lucide-react';

const today = new Date().toISOString().split('T')[0];
const firstOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];

const REPORT_TABS = [
  { key: 'valuation',       label: 'Inventory Valuation', icon: BarChart2 },
  { key: 'low-stock',       label: 'Low Stock Alert',     icon: AlertTriangle },
  { key: 'movement',        label: 'Movement Summary',    icon: TrendingUp },
];

export default function InventoryReportsPage() {
  const [activeTab,  setActiveTab]  = useState('valuation');
  const [loading,    setLoading]    = useState(false);
  const [categories, setCategories] = useState([]);

  // Valuation
  const [valuation,    setValuation]    = useState(null);
  const [valCatFilter, setValCatFilter] = useState('');

  // Low Stock
  const [lowStock, setLowStock] = useState([]);

  // Movement
  const [movement,    setMovement]    = useState([]);
  const [movFrom,     setMovFrom]     = useState(firstOfMonth);
  const [movTo,       setMovTo]       = useState(today);

  useEffect(() => {
    inventoryApi.categories.list()
      .then((r) => setCategories(r.data))
      .catch(() => {});
  }, []);

  const loadValuation = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (valCatFilter) params.categoryId = valCatFilter;
      const { data } = await inventoryApi.reports.valuation(params);
      setValuation(data);
    } catch { toast.error('Failed to load valuation report'); }
    finally { setLoading(false); }
  }, [valCatFilter]);

  const loadLowStock = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await inventoryApi.reports.lowStock();
      setLowStock(data);
    } catch { toast.error('Failed to load low stock report'); }
    finally { setLoading(false); }
  }, []);

  const loadMovement = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await inventoryApi.reports.movementSummary({ from: movFrom, to: movTo });
      setMovement(data);
    } catch { toast.error('Failed to load movement report'); }
    finally { setLoading(false); }
  }, [movFrom, movTo]);

  useEffect(() => {
    if (activeTab === 'valuation')  loadValuation();
    if (activeTab === 'low-stock')  loadLowStock();
    if (activeTab === 'movement')   loadMovement();
  }, [activeTab, loadValuation, loadLowStock, loadMovement]);

  // ── Print handlers ──────────────────────────────────────────
  const printValuation = async () => {
    if (!valuation) return;
    const groupRows = valuation.groups.map((g) => {
      const itemRows = g.items.map((i) => `
        <tr>
          <td class="mono">${i.sku}</td>
          <td>${i.name}</td>
          <td class="center">${i.unit}</td>
          <td class="right">${Number(i.qty).toLocaleString('en-PH')}</td>
          <td class="right">${phpFmt(i.costPrice)}</td>
          <td class="right bold blue">${phpFmt(i.value)}</td>
        </tr>`).join('');
      return `
        <tr class="section-row"><td colspan="6">${g.category}</td></tr>
        ${itemRows}
        <tr style="background:#f0f5ff"><td colspan="5" class="right bold">Subtotal — ${g.category}</td><td class="right bold blue">${phpFmt(g.subtotal)}</td></tr>`;
    }).join('');

    const body = `
      <table>
        <thead><tr>
          <th>SKU</th><th>Item Name</th><th class="center">Unit</th>
          <th class="right">Qty on Hand</th><th class="right">Unit Cost</th><th class="right">Total Value</th>
        </tr></thead>
        <tbody>${groupRows}</tbody>
        <tfoot><tr>
          <td colspan="5" class="right bold">GRAND TOTAL INVENTORY VALUE</td>
          <td class="right bold blue" style="font-size:13px">${phpFmt(valuation.grandTotal)}</td>
        </tr></tfoot>
      </table>`;
    await printDocument('Inventory Valuation Report', `As of ${dateFmt(new Date())}`, body);
  };

  const printLowStock = async () => {
    if (!lowStock.length) return;
    const rows = lowStock.map((i) => `
      <tr>
        <td class="mono">${i.sku}</td>
        <td class="bold">${i.name}</td>
        <td>${i.categoryName || '—'}</td>
        <td class="center">${i.unit}</td>
        <td class="right red bold">${Number(i.currentStock).toLocaleString('en-PH')}</td>
        <td class="right">${Number(i.reorderLevel).toLocaleString('en-PH')}</td>
        <td class="right bold">${(Number(i.reorderLevel) - Number(i.currentStock)).toLocaleString('en-PH')}</td>
        <td class="right">${phpFmt(Number(i.costPrice) * (Number(i.reorderLevel) - Number(i.currentStock)))}</td>
      </tr>`).join('');

    const body = `
      <div class="desc-box" style="background:#fef9c3;border-color:#fde68a;color:#92400e">
        ⚠ ${lowStock.length} item(s) at or below reorder level. Immediate replenishment recommended.
      </div>
      <table>
        <thead><tr>
          <th>SKU</th><th>Item Name</th><th>Category</th><th class="center">Unit</th>
          <th class="right">Current Stock</th><th class="right">Reorder Level</th>
          <th class="right">Shortage</th><th class="right">Est. Reorder Cost</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    await printDocument('Low Stock Alert Report', dateFmt(new Date()), body);
  };

  const printMovement = async () => {
    if (!movement.length) return;
    const rows = movement.map((m) => `
      <tr>
        <td class="mono">${m.sku}</td>
        <td class="bold">${m.name}</td>
        <td class="center">${m.unit}</td>
        <td class="right green bold">+${Number(m.totalIn).toLocaleString('en-PH')}</td>
        <td class="right red">-${Number(m.totalOut).toLocaleString('en-PH')}</td>
        <td class="right blue">${Number(m.totalAdj).toLocaleString('en-PH')}</td>
        <td class="right">${phpFmt(m.totalCostIn)}</td>
        <td class="right">${phpFmt(m.totalCostOut)}</td>
        <td class="right gray">${m.txnCount}</td>
      </tr>`).join('');

    const totals = movement.reduce((s, m) => ({
      in:  s.in  + m.totalIn,
      out: s.out + m.totalOut,
      cin: s.cin + m.totalCostIn,
      cout:s.cout+ m.totalCostOut,
    }), { in: 0, out: 0, cin: 0, cout: 0 });

    const body = `
      <div class="info-grid">
        <div class="info-box"><div class="info-lbl">Period</div><div class="info-val">${dateFmt(movFrom)} — ${dateFmt(movTo)}</div></div>
        <div class="info-box"><div class="info-lbl">Total Items Moved</div><div class="info-val">${movement.length}</div></div>
      </div>
      <table>
        <thead><tr>
          <th>SKU</th><th>Item Name</th><th class="center">Unit</th>
          <th class="right">Total In</th><th class="right">Total Out</th><th class="right">Adjustments</th>
          <th class="right">Cost In</th><th class="right">Cost Out</th><th class="right">Txns</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr>
          <td colspan="3" class="right bold">TOTALS</td>
          <td class="right bold green">+${totals.in.toLocaleString('en-PH')}</td>
          <td class="right bold red">-${totals.out.toLocaleString('en-PH')}</td>
          <td></td>
          <td class="right bold">${phpFmt(totals.cin)}</td>
          <td class="right bold">${phpFmt(totals.cout)}</td>
          <td></td>
        </tr></tfoot>
      </table>`;
    await printDocument('Inventory Movement Summary', `${dateFmt(movFrom)} to ${dateFmt(movTo)}`, body);
  };

  const handlePrint = () => {
    if (activeTab === 'valuation')  printValuation();
    if (activeTab === 'low-stock')  printLowStock();
    if (activeTab === 'movement')   printMovement();
  };

  const handleRefresh = () => {
    if (activeTab === 'valuation')  loadValuation();
    if (activeTab === 'low-stock')  loadLowStock();
    if (activeTab === 'movement')   loadMovement();
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Inventory Reports</h1>
          <p className="page-subtitle">Valuation, low stock, movement analysis</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleRefresh} className="btn-secondary flex items-center gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <button onClick={handlePrint} className="btn-secondary flex items-center gap-2">
            <Printer className="w-4 h-4" /> Print
          </button>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-xl w-fit">
        {REPORT_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab.key
                ? 'bg-white text-blue-700 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Valuation Report ── */}
      {activeTab === 'valuation' && (
        <div>
          {/* Filter */}
          <div className="card mb-4">
            <div className="card-body flex gap-3">
              <select className="input w-52" value={valCatFilter}
                onChange={(e) => setValCatFilter(e.target.value)}>
                <option value="">All Categories</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>

          {loading ? (
            <div className="card card-body text-center text-gray-400 py-12">Loading…</div>
          ) : !valuation ? null : (
            <>
              {/* Grand total card */}
              <div className="card card-body mb-4 flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Total Inventory Value</p>
                  <p className="text-3xl font-black text-blue-700 mt-1">{phpFmt(valuation.grandTotal)}</p>
                  <p className="text-xs text-gray-400 mt-1">As of {dateFmt(new Date())}</p>
                </div>
                <BarChart2 className="w-12 h-12 text-blue-100" />
              </div>

              {/* Groups */}
              {valuation.groups.map((g) => (
                <div key={g.category} className="card mb-4">
                  <div className="px-4 py-3 border-b bg-blue-50 flex justify-between items-center">
                    <span className="font-bold text-blue-700">{g.category}</span>
                    <span className="font-bold text-blue-700">{phpFmt(g.subtotal)}</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 border-b">
                          <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">SKU</th>
                          <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Name</th>
                          <th className="px-4 py-2 text-center text-xs font-semibold text-gray-500 uppercase">Unit</th>
                          <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Qty on Hand</th>
                          <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Unit Cost</th>
                          <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Total Value</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {g.items.map((i) => (
                          <tr key={i.sku} className="hover:bg-gray-50">
                            <td className="px-4 py-2.5 font-mono text-xs text-gray-500">{i.sku}</td>
                            <td className="px-4 py-2.5 font-medium text-gray-900">{i.name}</td>
                            <td className="px-4 py-2.5 text-center text-gray-500">{i.unit}</td>
                            <td className="px-4 py-2.5 text-right text-gray-700">{Number(i.qty).toLocaleString('en-PH')}</td>
                            <td className="px-4 py-2.5 text-right text-gray-700">{phpFmt(i.costPrice)}</td>
                            <td className="px-4 py-2.5 text-right font-semibold text-blue-700">{phpFmt(i.value)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* ── Low Stock Report ── */}
      {activeTab === 'low-stock' && (
        <div>
          {loading ? (
            <div className="card card-body text-center text-gray-400 py-12">Loading…</div>
          ) : (
            <>
              {lowStock.length > 0 && (
                <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-xl flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-yellow-800">{lowStock.length} item(s) need restocking</p>
                    <p className="text-sm text-yellow-700 mt-0.5">Items at or below their reorder level. Consider placing purchase orders.</p>
                  </div>
                </div>
              )}
              <div className="card">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b">
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">SKU</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Item Name</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Category</th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Unit</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Current Stock</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Reorder Level</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Shortage</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Est. Cost to Reorder</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {lowStock.length === 0 ? (
                        <tr><td colSpan={8} className="px-4 py-12 text-center text-green-600 font-medium">✓ All items are adequately stocked</td></tr>
                      ) : lowStock.map((i, idx) => {
                        const shortage = Number(i.reorderLevel) - Number(i.currentStock);
                        const estCost  = shortage * Number(i.costPrice);
                        const isOut    = Number(i.currentStock) <= 0;
                        return (
                          <tr key={idx} className={isOut ? 'bg-red-50' : 'bg-yellow-50'}>
                            <td className="px-4 py-3 font-mono text-xs text-gray-500">{i.sku}</td>
                            <td className="px-4 py-3 font-medium text-gray-900">{i.name}</td>
                            <td className="px-4 py-3 text-gray-500">{i.categoryName || '—'}</td>
                            <td className="px-4 py-3 text-center text-gray-500">{i.unit}</td>
                            <td className={`px-4 py-3 text-right font-bold ${isOut ? 'text-red-700' : 'text-yellow-700'}`}>
                              {Number(i.currentStock).toLocaleString('en-PH')}
                              {isOut && <span className="ml-1 badge badge-red">OUT</span>}
                            </td>
                            <td className="px-4 py-3 text-right text-gray-600">{Number(i.reorderLevel).toLocaleString('en-PH')}</td>
                            <td className="px-4 py-3 text-right font-semibold text-red-700">{shortage.toLocaleString('en-PH')}</td>
                            <td className="px-4 py-3 text-right font-semibold text-gray-800">{phpFmt(estCost)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    {lowStock.length > 0 && (
                      <tfoot>
                        <tr className="bg-blue-50 border-t-2 border-blue-200">
                          <td colSpan={7} className="px-4 py-3 text-right font-bold text-gray-700 text-sm uppercase">Total Estimated Reorder Cost</td>
                          <td className="px-4 py-3 text-right font-bold text-blue-700">
                            {phpFmt(lowStock.reduce((s, i) => {
                              const shortage = Number(i.reorderLevel) - Number(i.currentStock);
                              return s + shortage * Number(i.costPrice);
                            }, 0))}
                          </td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Movement Summary ── */}
      {activeTab === 'movement' && (
        <div>
          {/* Date range */}
          <div className="card mb-4">
            <div className="card-body flex gap-3 items-center">
              <label className="text-sm text-gray-600 font-medium">Period:</label>
              <input className="input w-36" type="date" value={movFrom}
                onChange={(e) => setMovFrom(e.target.value)} />
              <span className="text-gray-400">to</span>
              <input className="input w-36" type="date" value={movTo}
                onChange={(e) => setMovTo(e.target.value)} />
            </div>
          </div>

          {loading ? (
            <div className="card card-body text-center text-gray-400 py-12">Loading…</div>
          ) : (
            <>
              {/* Summary row */}
              {movement.length > 0 && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                  <div className="card card-body">
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Items Moved</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">{movement.length}</p>
                  </div>
                  <div className="card card-body">
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Total Inbound</p>
                    <p className="text-2xl font-bold text-green-600 mt-1">
                      +{movement.reduce((s, m) => s + m.totalIn, 0).toLocaleString('en-PH')}
                    </p>
                    <p className="text-xs text-gray-400">{phpFmt(movement.reduce((s, m) => s + m.totalCostIn, 0))}</p>
                  </div>
                  <div className="card card-body">
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Total Outbound</p>
                    <p className="text-2xl font-bold text-red-600 mt-1">
                      -{movement.reduce((s, m) => s + m.totalOut, 0).toLocaleString('en-PH')}
                    </p>
                    <p className="text-xs text-gray-400">{phpFmt(movement.reduce((s, m) => s + m.totalCostOut, 0))}</p>
                  </div>
                  <div className="card card-body">
                    <p className="text-xs text-gray-500 uppercase tracking-wide">Total Transactions</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">
                      {movement.reduce((s, m) => s + m.txnCount, 0)}
                    </p>
                  </div>
                </div>
              )}

              <div className="card">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b">
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">SKU</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Item Name</th>
                        <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Unit</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Total In</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Total Out</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Adjustments</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Cost In</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">COGS Out</th>
                        <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Txns</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {movement.length === 0 ? (
                        <tr><td colSpan={9} className="px-4 py-12 text-center text-gray-400">No movement in this period</td></tr>
                      ) : movement.map((m) => (
                        <tr key={m.itemId} className="hover:bg-gray-50">
                          <td className="px-4 py-3 font-mono text-xs text-gray-500">{m.sku}</td>
                          <td className="px-4 py-3 font-medium text-gray-900">{m.name}</td>
                          <td className="px-4 py-3 text-center text-gray-500">{m.unit}</td>
                          <td className="px-4 py-3 text-right font-semibold text-green-700">
                            {m.totalIn > 0 ? `+${m.totalIn.toLocaleString('en-PH')}` : '—'}
                          </td>
                          <td className="px-4 py-3 text-right font-semibold text-red-700">
                            {m.totalOut > 0 ? `-${m.totalOut.toLocaleString('en-PH')}` : '—'}
                          </td>
                          <td className="px-4 py-3 text-right text-blue-700">
                            {m.totalAdj !== 0 ? m.totalAdj.toLocaleString('en-PH') : '—'}
                          </td>
                          <td className="px-4 py-3 text-right text-gray-700">{m.totalCostIn > 0 ? phpFmt(m.totalCostIn) : '—'}</td>
                          <td className="px-4 py-3 text-right text-gray-700">{m.totalCostOut > 0 ? phpFmt(m.totalCostOut) : '—'}</td>
                          <td className="px-4 py-3 text-right text-gray-400">{m.txnCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
