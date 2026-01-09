import { System } from "../System";
import { EntityManager } from "../EntityManager";
import { InputComponent } from "../components/InputComponent";
import { ConfigManager } from "../../../config/MasterConfig";

export class InputSystem implements System {
    public readonly id = 'input_system';

    update(dt: number, entityManager: EntityManager, inputManager?: any): void {
        if (!inputManager) return;

        const config = ConfigManager.getInstance();
        const moveUp = config.get<string>('Keybindings', 'moveUp');
        const moveDown = config.get<string>('Keybindings', 'moveDown');
        const moveLeft = config.get<string>('Keybindings', 'moveLeft');
        const moveRight = config.get<string>('Keybindings', 'moveRight');
        const fireKey = config.get<string>('Keybindings', 'fire');

        const entities = entityManager.query(['input']);

        for (const entityId of entities) {
            const input = entityManager.getComponent<InputComponent>(entityId, 'input')!;

            let throttle = 0;
            if (inputManager.isKeyDown(moveUp)) throttle += 1;
            if (inputManager.isKeyDown(moveDown)) throttle -= 1;

            let turn = 0;
            if (inputManager.isKeyDown(moveLeft)) turn -= 1;
            if (inputManager.isKeyDown(moveRight)) turn += 1;

            input.throttle = throttle;
            input.turn = turn;
            input.isFiring = inputManager.isKeyDown(fireKey);
            input.activeWeapon = config.get<string>('Player', 'activeWeapon');
            
            // Capture mouse for aiming
            input.mouseX = inputManager.mouseX;
            input.mouseY = inputManager.mouseY;
        }
    }
}
