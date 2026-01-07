import { Component } from "../Component";

export class TagComponent implements Component {
    public readonly type = 'tag';
    
    constructor(
        public tag: string
    ) {}
}
