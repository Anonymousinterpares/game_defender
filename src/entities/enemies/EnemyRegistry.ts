import { EnemyDossier, AIBehavior } from "../../core/ecs/components/AIDossier";

export class EnemyRegistry {
    private static instance: EnemyRegistry;
    private dossiers: Map<string, EnemyDossier> = new Map();

    private constructor() {
        this.registerDefaultEnemies();
    }

    public static getInstance(): EnemyRegistry {
        if (!EnemyRegistry.instance) {
            EnemyRegistry.instance = new EnemyRegistry();
        }
        return EnemyRegistry.instance;
    }

    public register(dossier: EnemyDossier): void {
        this.dossiers.set(dossier.name.toLowerCase(), dossier);
    }

    public get(name: string): EnemyDossier | undefined {
        return this.dossiers.get(name.toLowerCase());
    }

    public getAllNames(): string[] {
        return Array.from(this.dossiers.keys());
    }

    public getRandomName(): string {
        const names = this.getAllNames();
        return names[Math.floor(Math.random() * names.length)];
    }

    private registerDefaultEnemies(): void {
        // We will move these to separate files soon, but for bootstrap:
        this.register({
            name: 'Scout',
            behavior: AIBehavior.CHASE,
            baseStats: { hp: 15, speed: 180, radius: 10, attackRange: 50 },
            visuals: { color: '#00ff00', shape: 'triangle', glowColor: '#004400' },
            traits: ['swift']
        });

        this.register({
            name: 'Heavy',
            behavior: AIBehavior.BREACHER,
            baseStats: { hp: 100, speed: 80, radius: 18, attackRange: 40 },
            visuals: { color: '#aa0000', shape: 'square', glowColor: '#440000' },
            traits: ['armored']
        });

        this.register({
            name: 'Sniper',
            behavior: AIBehavior.SNIPER,
            baseStats: { hp: 30, speed: 120, radius: 12, attackRange: 400, preferredDistance: 250 },
            visuals: { color: '#00ffff', shape: 'triangle', glowColor: '#004444' },
            traits: []
        });
    }
}
