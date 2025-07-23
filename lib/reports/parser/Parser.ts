import { Token, tokenize } from './Tokenize';
import { parseQueryInterval } from './parseQueryInterval';
import { parseQueryType } from './parseQueryType';
import { parseSelection } from './parseSelection';
import { parseGroupBy } from './parseGroupBy';
import { parseSort } from './parseSort';
import { parseList } from './parseList';
import { parseCustomTitle } from './parseCustomTitle';
import { parseWorkspace } from './parseWorkspace'; // <-- IMPORT THE NEW PARSER

export class Parser {
	public tokens: Token[];
	public query: any = {};
	private pos = 0;

	constructor(source: string) {
		this.tokens = tokenize(source);
		this.query = {
			queryType: 'summary',
			interval: null,
			selection: {
				projects: { include: [], exclude: [] },
				clients: { include: [], exclude: [] },
				tags: { include: [], exclude: [] },
			},
			groupBy: null,
			sort: { field: 'time', order: 'desc' },
			list: { show: ['project', 'time'] },
			customTitle: null,
			workspace: 'work', // <-- SET "work" AS THE DEFAULT
		};
	}

	parse() {
		// The order here matters.
		parseQueryType(this);
		parseQueryInterval(this);
		parseWorkspace(this); // <-- ADD THE WORKSPACE PARSER HERE
		parseSelection(this);
		parseGroupBy(this);
		parseSort(this);
		parseList(this);
		parseCustomTitle(this);

		return this.query;
	}

	// ... (the rest of the file remains the same)

	public peek(type: string, value?: string): boolean {
		if (this.pos >= this.tokens.length) {
			return false;
		}

		const t = this.tokens[this.pos];
		if (t.type !== type) {
			return false;
		}

		if (value && t.value.toLowerCase() !== value.toLowerCase()) {
			return false;
		}

		return true;
	}

	public consume(type?: string, value?: string): Token {
		if (this.pos >= this.tokens.length) {
			throw this.error(`Unexpected end of input`);
		}

		const t = this.tokens[this.pos];

		if (type && t.type !== type) {
			throw this.error(`Expected token type "${type}" but got "${t.type}"`);
		}

		if (value && t.value.toLowerCase() !== value.toLowerCase()) {
			throw this.error(`Expected "${value}" but got "${t.value}"`);
		}

		this.pos++;
		return t;
	}

	public error(message: string): Error {
		const e: any = new Error(message);
		e.name = 'ParsingError';
		return e;
	}
}
