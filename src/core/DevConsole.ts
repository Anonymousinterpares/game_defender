import { SceneManager } from './SceneManager';

export class DevConsole {
    private container: HTMLDivElement;
    private input: HTMLInputElement;
    private isOpen: boolean = false;

    constructor(private sceneManager: SceneManager) {
        this.container = document.createElement('div');
        this.container.id = 'dev-console';
        this.container.style.display = 'none';
        
        this.input = document.createElement('input');
        this.input.type = 'text';
        this.input.placeholder = 'Enter command...';
        
        this.container.appendChild(this.input);
        document.body.appendChild(this.container);

        window.addEventListener('keydown', (e) => {
            if (e.code === 'Backquote') {
                e.preventDefault();
                this.toggle();
            }
            if (this.isOpen && e.key === 'Enter') {
                this.execute();
            }
        });
    }

    private toggle(): void {
        this.isOpen = !this.isOpen;
        this.container.style.display = this.isOpen ? 'block' : 'none';
        if (this.isOpen) {
            this.input.value = '';
            this.input.focus();
        }
    }

    private execute(): void {
        const cmd = this.input.value;
        const currentScene = this.sceneManager.getCurrentScene();
        if (currentScene && currentScene.handleCommand) {
            const success = currentScene.handleCommand(cmd);
            if (success) {
                console.log(`Command executed: ${cmd}`);
            } else {
                console.warn(`Command failed or not recognized: ${cmd}`);
            }
        }
        this.toggle();
    }
}
