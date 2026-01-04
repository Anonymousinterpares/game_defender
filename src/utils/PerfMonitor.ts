export class PerfMonitor {
    private static instance: PerfMonitor;
    private metrics: Map<string, number[]> = new Map();
    private currentFrameMetrics: Map<string, number> = new Map();
    private historyLimit: number = 200;
    private sessionData: Map<string, { sum: number, count: number, max: number }> = new Map();
    private isSessionActive: boolean = false;
    
    private constructor() {}

    public static getInstance(): PerfMonitor {
        if (!PerfMonitor.instance) PerfMonitor.instance = new PerfMonitor();
        return PerfMonitor.instance;
    }

    public startSession(): void {
        this.sessionData.clear();
        this.isSessionActive = true;
    }

    public endSession(): void {
        this.isSessionActive = false;
    }

    public begin(name: string): void {
        this.currentFrameMetrics.set(name, performance.now());
    }

    public end(name: string): void {
        const start = this.currentFrameMetrics.get(name);
        if (start !== undefined) {
            const duration = performance.now() - start;
            if (!this.metrics.has(name)) this.metrics.set(name, []);
            const history = this.metrics.get(name)!;
            history.push(duration);
            if (history.length > this.historyLimit) history.shift();

            if (this.isSessionActive) {
                if (!this.sessionData.has(name)) {
                    this.sessionData.set(name, { sum: 0, count: 0, max: 0 });
                }
                const data = this.sessionData.get(name)!;
                data.sum += duration;
                data.count++;
                data.max = Math.max(data.max, duration);
            }
        }
    }

    public generateReport(): string {
        let report = "=== BENCHMARK REPORT ===\n";
        this.sessionData.forEach((data, name) => {
            const avg = (data.sum / data.count).toFixed(3);
            const max = data.max.toFixed(3);
            report += `${name.padEnd(20)}: Avg ${avg}ms | Max ${max}ms\n`;
        });
        
        // Basic bottleneck detection
        let worstName = "";
        let worstAvg = 0;
        this.sessionData.forEach((data, name) => {
            const avg = data.sum / data.count;
            if (avg > worstAvg) {
                worstAvg = avg;
                worstName = name;
            }
        });

        if (worstName) {
            report += `\nPRIMARY BOTTLENECK: ${worstName}\n`;
            if (worstName.includes('lighting')) {
                report += "ADVICE: Reduce resolutionScale or light count.\n";
            } else if (worstName.includes('particle')) {
                report += "ADVICE: Reduce particle count or simplify materials.\n";
            }
        }
        
        return report;
    }

    public getAverage(name: string): number {
        const history = this.metrics.get(name);
        if (!history || history.length === 0) return 0;
        return history.reduce((a, b) => a + b, 0) / history.length;
    }

    public getHistory(name: string): number[] {
        return this.metrics.get(name) || [];
    }

    public render(ctx: CanvasRenderingContext2D): void {
        const x = 10, y = 150;
        const w = 250, h = 180;
        
        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = '#0f0';
        ctx.strokeRect(x, y, w, h);

        ctx.fillStyle = '#0f0';
        ctx.font = '12px monospace';
        ctx.fillText('PERFORMANCE METRICS (ms)', x + 5, y + 15);

        let rowY = y + 35;
        this.metrics.forEach((history, name) => {
            const avg = this.getAverage(name).toFixed(2);
            ctx.fillText(`${name}: ${avg}`, x + 5, rowY);
            
            // Draw mini sparkline
            ctx.beginPath();
            ctx.strokeStyle = '#0af';
            const graphW = 100;
            const graphH = 15;
            const graphX = x + 140;
            for (let i = 0; i < history.length; i++) {
                const val = (history[i] / 16.6) * graphH;
                const lx = graphX + (i / this.historyLimit) * graphW;
                const ly = rowY - val;
                if (i === 0) ctx.moveTo(lx, ly);
                else ctx.lineTo(lx, ly);
            }
            ctx.stroke();

            rowY += 20;
        });

        ctx.restore();
    }
}
