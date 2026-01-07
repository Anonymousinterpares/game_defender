import { Component } from "../Component";

export class InputComponent implements Component {
    public readonly type = 'input';
    
    constructor(
        public throttle: number = 0,     // -1 to 1
        public turn: number = 0,         // -1 to 1 (left/right)
        public isFiring: boolean = false,
        public activeWeapon: string = 'cannon'
    ) {}
}
