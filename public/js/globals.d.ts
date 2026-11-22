// Browser globals provided by the vendor <script> tags in index.html.
import type { GridStack as GridStackClass } from 'gridstack';
import type * as LightweightChartsModule from 'lightweight-charts';

declare global {
  const GridStack: typeof GridStackClass;
  interface Window { LightweightCharts: typeof LightweightChartsModule }
}
