const money = (value) => `$${(value ?? 0).toFixed(value > 0 && value < 1 ? 3 : 2)}`;
const MONTH = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const TOOL = { enhance: 'Enhance', colorize: 'Colorize', repair: 'Repair', upscale: 'Upscale', animate: 'Animate', 'edit-video': 'Edit Video' };
const runs = (n) => `${n} run${n === 1 ? '' : 's'}`;

export function SpendingSummary({ spending }) {
  if (!spending.runs) return <p className="text-sm text-muted-foreground">Nothing spent yet.</p>;
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap gap-6">
        <div>
          <p className="text-xs text-muted-foreground">All time</p>
          <p className="text-lg font-semibold tabular-nums">{money(spending.total)}</p>
          <p className="text-xs text-muted-foreground">{runs(spending.runs)}</p>
        </div>
        {spending.tools.map((tool) => (
          <div key={tool.tool}>
            <p className="text-xs text-muted-foreground">{TOOL[tool.tool] ?? tool.tool}</p>
            <p className="text-lg font-semibold tabular-nums">{money(tool.usd)}</p>
            <p className="text-xs text-muted-foreground">{runs(tool.runs)}</p>
          </div>
        ))}
      </div>
      <table className="w-full text-left">
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th className="py-1 font-normal">Month</th>
            <th className="py-1 text-right font-normal">Runs</th>
            <th className="py-1 text-right font-normal">Spent</th>
          </tr>
        </thead>
        <tbody>
          {spending.months.map((month) => (
            <tr key={month.month} className="border-t">
              <td className="py-1.5">{MONTH.format(new Date(`${month.month}-01T00:00:00Z`))}</td>
              <td className="py-1.5 text-right tabular-nums">{month.runs}</td>
              <td className="py-1.5 text-right tabular-nums">{money(month.usd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-muted-foreground">Your full OpenRouter history, including other apps, is on openrouter.ai.</p>
    </div>
  );
}
