// 统一的快照撤销栈（环形，默认 50 步）
export class UndoManager {
    constructor(limit = 50) {
        this.limit = limit;
        this.stack = [];
    }

    push(snap) {
        this.stack.push(snap);
        if (this.stack.length > this.limit) this.stack.shift();
    }

    pop() {
        return this.stack.pop();
    }

    clear() {
        this.stack.length = 0;
    }

    get length() {
        return this.stack.length;
    }
}
