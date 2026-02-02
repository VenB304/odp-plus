export class InjectData {
    constructor(
        public redirectData: RedirectData | null,
        public odpTag: string | null,
    ) {}
}

export class RedirectData {
    constructor(
        public serverWSURL: string,
        public prefixWSURL: string,
        public postfixWSURL: string,
    ) {}
}
