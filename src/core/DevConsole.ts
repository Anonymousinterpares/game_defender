import { SceneManager } from './SceneManager';

export class DevConsole {
    private container: HTMLDivElement;
    private input: HTMLInputElement;
    private isOpen: boolean = false;
    private history: string[] = [];
    private historyIndex: number = -1;

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

            if (this.isOpen) {
                if (e.key === 'Enter') {
                    this.execute();
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    this.navigateHistory(-1);
                } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    this.navigateHistory(1);
                }
            }
        });
    }

    private toggle(): void {
        this.isOpen = !this.isOpen;
        this.container.style.display = this.isOpen ? 'block' : 'none';
        if (this.isOpen) {
            this.input.value = '';
            this.historyIndex = -1;
            this.input.focus();
        }
    }

    private navigateHistory(direction: number): void {
        if (this.history.length === 0) return;

        // direction -1 for ArrowUp (previous command), 1 for ArrowDown (next command)
        if (this.historyIndex === -1) {
            if (direction === -1) {
                this.historyIndex = this.history.length - 1;
            } else {
                return; // Nothing to do if we are at newest and press down
            }
        } else {
            this.historyIndex += direction;
        }

        if (this.historyIndex < 0) {
            this.historyIndex = 0;
        } else if (this.historyIndex >= this.history.length) {
            this.historyIndex = -1;
            this.input.value = '';
            return;
        }

        this.input.value = this.history[this.historyIndex];
        // Move cursor to end
        setTimeout(() => {
            this.input.setSelectionRange(this.input.value.length, this.input.value.length);
        }, 0);
    }

    private execute(): void {
        const cmd = this.input.value.trim();
        if (cmd) {
            // Add to history if it's different from the last one
            if (this.history.length === 0 || this.history[this.history.length - 1] !== cmd) {
                this.history.push(cmd);
            }
            if (this.history.length > 50) this.history.shift();
        }
        
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
