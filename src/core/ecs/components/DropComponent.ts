import { Component } from "../Component";
export { DropType } from "../../../entities/Drop";
import { DropType } from "../../../entities/Drop";

export class DropComponent implements Component {
    public readonly type = 'drop';

    constructor(
        public dropType: DropType = DropType.COIN,
        public value: number = 10,
        public collected: boolean = false
    ) { }
}
