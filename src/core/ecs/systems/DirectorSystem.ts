import { System } from "../System";
import { EntityManager } from "../EntityManager";
import { TransformComponent } from "../components/TransformComponent";
import { AIComponent } from "../components/AIComponent";
import { EventBus, GameEvent } from "../../EventBus";

export class DirectorSystem implements System {
    public readonly id = 'director';
    
    private attackTokensMax = 3;
    private flankTokensMax = 2;
    
    private activeAttackTokens: Set<string> = new Set();
    private activeFlankTokens: Set<string> = new Set();
    
    private requestQueue: { entityId: string, tokenType: 'attack' | 'flank' | 'suppress' }[] = [];

    constructor() {
        this.setupListeners();
    }

    private setupListeners(): void {
        const eb = EventBus.getInstance();
        
        eb.on(GameEvent.AI_REQUEST_TOKEN, (data) => {
            this.requestQueue.push(data);
        });

        eb.on(GameEvent.AI_RELEASE_TOKEN, (data) => {
            if (data.tokenType === 'attack') this.activeAttackTokens.delete(data.entityId);
            if (data.tokenType === 'flank') this.activeFlankTokens.delete(data.entityId);
        });
        
        eb.on(GameEvent.ENTITY_DEATH, (data) => {
            this.activeAttackTokens.delete(data.entityId);
            this.activeFlankTokens.delete(data.entityId);
        });
    }

    update(dt: number, entityManager: EntityManager): void {
        const playerEntity = entityManager.query(['player'])[0];
        if (!playerEntity) return;
        const playerTransform = entityManager.getComponent<TransformComponent>(playerEntity, 'transform')!;

        // 1. REVOCATION: Check if active attackers are still efficient
        const aiEntities = entityManager.query(['ai', 'transform']);
        for (const id of aiEntities) {
            const ai = entityManager.getComponent<AIComponent>(id, 'ai')!;
            if (ai.activeToken === 'attack') {
                const transform = entityManager.getComponent<TransformComponent>(id, 'transform')!;
                const dx = playerTransform.x - transform.x;
                const dy = playerTransform.y - transform.y;
                const dist = Math.sqrt(dx*dx + dy*dy);
                
                // Revoke if too far or lost track significantly
                if (dist > 600 || ai.perceptionCertainty < 0.2) {
                    ai.activeToken = null;
                    this.activeAttackTokens.delete(id);
                }
            }
        }

        // 2. ALLOCATION: Sort queue by efficiency score
        if (this.requestQueue.length > 0) {
            const scoredQueue = this.requestQueue.map(req => {
                const ai = entityManager.getComponent<AIComponent>(req.entityId, 'ai')!;
                const transform = entityManager.getComponent<TransformComponent>(req.entityId, 'transform')!;
                const dist = Math.sqrt((playerTransform.x - transform.x)**2 + (playerTransform.y - transform.y)**2);
                
                // Efficiency Score
                const score = (1000 / (dist + 1)) * (ai.perceivedTargetPos ? 2.0 : 1.0) * (0.5 + ai.perceptionCertainty);
                return { req, score };
            });

            scoredQueue.sort((a, b) => b.score - a.score);
            this.requestQueue = scoredQueue.map(s => s.req);

            // Process queue
            let i = 0;
            while (i < this.requestQueue.length) {
                const request = this.requestQueue[i];
                let granted = false;

                if (request.tokenType === 'attack' && this.activeAttackTokens.size < this.attackTokensMax) {
                    this.activeAttackTokens.add(request.entityId);
                    granted = true;
                } else if (request.tokenType === 'flank' && this.activeFlankTokens.size < this.flankTokensMax) {
                    this.activeFlankTokens.add(request.entityId);
                    granted = true;
                }

                if (granted) {
                    const ai = entityManager.getComponent<AIComponent>(request.entityId, 'ai');
                    if (ai) {
                        ai.activeToken = request.tokenType;
                        EventBus.getInstance().emit(GameEvent.AI_ASSIGN_TOKEN, {
                            entityId: request.entityId,
                            tokenType: request.tokenType
                        });
                    }
                    this.requestQueue.splice(i, 1);
                } else {
                    i++;
                }
            }
        }
    }
}
