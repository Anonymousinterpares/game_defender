export interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface QuadtreeItem {
    x: number;
    y: number;
    radius: number;
    [key: string]: any;
}

export class Quadtree<T extends QuadtreeItem> {
    private items: T[] = [];
    private children: Quadtree<T>[] = [];
    private maxItems: number = 10;
    private maxDepth: number = 5;

    constructor(private bounds: Rect, private depth: number = 0) {}

    public clear(): void {
        this.items = [];
        this.children = [];
    }

    private split(): void {
        const subW = this.bounds.w / 2;
        const subH = this.bounds.h / 2;
        const x = this.bounds.x;
        const y = this.bounds.y;

        this.children.push(new Quadtree({ x: x + subW, y: y, w: subW, h: subH }, this.depth + 1));
        this.children.push(new Quadtree({ x: x, y: y, w: subW, h: subH }, this.depth + 1));
        this.children.push(new Quadtree({ x: x, y: y + subH, w: subW, h: subH }, this.depth + 1));
        this.children.push(new Quadtree({ x: x + subW, y: y + subH, w: subW, h: subH }, this.depth + 1));
    }

    private getIndex(item: T): number {
        const verticalMidpoint = this.bounds.x + this.bounds.w / 2;
        const horizontalMidpoint = this.bounds.y + this.bounds.h / 2;

        const startIsWest = item.x - item.radius < verticalMidpoint;
        const endIsEast = item.x + item.radius > verticalMidpoint;
        const startIsNorth = item.y - item.radius < horizontalMidpoint;
        const endIsSouth = item.y + item.radius > horizontalMidpoint;

        // If it straddles the lines, it belongs in this parent node
        if ((startIsWest && endIsEast) || (startIsNorth && endIsSouth)) {
            return -1;
        }

        if (startIsNorth) {
            if (startIsWest) return 1;
            if (endIsEast) return 0;
        } else if (endIsSouth) {
            if (startIsWest) return 2;
            if (endIsEast) return 3;
        }

        return -1;
    }

    public insert(item: T): void {
        if (this.children.length > 0) {
            const index = this.getIndex(item);
            if (index !== -1) {
                this.children[index].insert(item);
                return;
            }
        }

        this.items.push(item);

        if (this.items.length > this.maxItems && this.depth < this.maxDepth) {
            if (this.children.length === 0) {
                this.split();
            }

            let i = 0;
            while (i < this.items.length) {
                const index = this.getIndex(this.items[i]);
                if (index !== -1) {
                    this.children[index].insert(this.items.splice(i, 1)[0]);
                } else {
                    i++;
                }
            }
        }
    }

    public retrieve(rect: Rect): T[] {
        let result: T[] = [...this.items];

        if (this.children.length > 0) {
            const verticalMidpoint = this.bounds.x + this.bounds.w / 2;
            const horizontalMidpoint = this.bounds.y + this.bounds.h / 2;

            const startIsWest = rect.x < verticalMidpoint;
            const endIsEast = rect.x + rect.w > verticalMidpoint;
            const startIsNorth = rect.y < horizontalMidpoint;
            const endIsSouth = rect.y + rect.h > horizontalMidpoint;

            if (startIsNorth) {
                if (startIsWest) result = result.concat(this.children[1].retrieve(rect));
                if (endIsEast) result = result.concat(this.children[0].retrieve(rect));
            }
            if (endIsSouth) {
                if (startIsWest) result = result.concat(this.children[2].retrieve(rect));
                if (endIsEast) result = result.concat(this.children[3].retrieve(rect));
            }
        }

        return result;
    }
}
