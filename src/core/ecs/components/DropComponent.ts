import { Component } from "../Component";

export enum DropType {
    COIN = 'coin',
    BOOSTER = 'booster'
}

export class DropComponent implements Component {
    public readonly type = 'drop';

    constructor(
        public dropType: DropType = DropType.COIN,
        public value: number = 10,
        public collected: boolean = false
    ) {}
}
