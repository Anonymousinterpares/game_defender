import { Component } from "../Component";

export class SegmentComponent implements Component {
    public readonly type = 'segment';

    constructor(
        public leaderId: string,
        public spacing: number
    ) { }
}
