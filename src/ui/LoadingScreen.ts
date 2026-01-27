import { ConfigManager } from '../config/MasterConfig';

export class LoadingScreen {
    private container: HTMLDivElement;
    private barContainer: HTMLDivElement;
    private rectangles: HTMLDivElement[] = [];
    private textElement: HTMLHeadingElement;
    private animationId: number | null = null;
    private startTime: number = 0;
    private numRects: number = 10;

    constructor() {
        this.container = document.createElement('div');
        this.container.id = 'loading-screen';
        this.container.style.position = 'fixed';
        this.container.style.top = '0';
        this.container.style.left = '0';
        this.container.style.width = '100%';
        this.container.style.height = '100%';
        this.container.style.backgroundColor = 'rgba(0, 0, 0, 0.9)';
        this.container.style.zIndex = '9999';
        this.container.style.display = 'none';
        this.container.style.flexDirection = 'column';
        this.container.style.justifyContent = 'center';
        this.container.style.alignItems = 'center';
        this.container.style.pointerEvents = 'auto';

        this.textElement = document.createElement('h1');
        this.container.appendChild(this.textElement);

        this.barContainer = document.createElement('div');
        this.barContainer.style.display = 'flex';
        this.barContainer.style.gap = '8px';
        this.barContainer.style.marginTop = '20px';
        this.container.appendChild(this.barContainer);

        for (let i = 0; i < this.numRects; i++) {
            const rect = document.createElement('div');
            rect.style.width = '20px';
            rect.style.height = '30px';
            rect.style.backgroundColor = 'var(--steam-gold, #cfaa6e)';
            rect.style.opacity = '0.1';
            rect.style.boxShadow = '0 0 10px rgba(207, 170, 110, 0.3)';
            this.barContainer.appendChild(rect);
            this.rectangles.push(rect);
        }

        document.body.appendChild(this.container);
        this.applyConfig();
    }

    private applyConfig(): void {
        const config = ConfigManager.getInstance();
        const content = config.get<string>('Loading', 'content') || 'LOADING...';
        const fontType = config.get<string>('Loading', 'fontType') || "'Share Tech Mono', monospace";
        const fontColor = config.get<string>('Loading', 'fontColor') || '#cfaa6e';
        const fontSize = config.get<number>('Loading', 'fontSize') || 24;

        this.textElement.innerText = content;
        this.textElement.style.fontFamily = fontType;
        this.textElement.style.color = fontColor;
        this.textElement.style.fontSize = `${fontSize}px`;
        this.textElement.style.textShadow = `0 0 15px ${fontColor}88`;

        this.rectangles.forEach(r => {
            r.style.backgroundColor = fontColor;
        });
    }

    public show(): void {
        this.applyConfig();
        this.container.style.display = 'flex';
        this.startTime = performance.now();
        this.animate();
    }

    public hide(): void {
        this.container.style.display = 'none';
        if (this.animationId !== null) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }

    private animate = (): void => {
        const now = performance.now();
        const elapsed = (now - this.startTime) / 1000;

        // Ping-pong index calculation
        // We want a value that goes 0 -> numRects-1 -> 0
        const speed = 1.5; // Cycles per second
        const cycle = (elapsed * speed) % 2; // 0 to 2
        let targetIdx = cycle < 1 ? cycle * this.numRects : (2 - cycle) * this.numRects;

        this.rectangles.forEach((rect, i) => {
            // Distance of this rectangle from the "hot" spot
            const dist = Math.abs(i - targetIdx);
            const intensity = Math.max(0.1, 1.0 - dist * 0.5); // Falloff
            rect.style.opacity = intensity.toString();

            if (intensity > 0.5) {
                rect.style.boxShadow = `0 0 15px ${this.textElement.style.color}`;
            } else {
                rect.style.boxShadow = 'none';
            }
        });

        this.animationId = requestAnimationFrame(this.animate);
    }
}
