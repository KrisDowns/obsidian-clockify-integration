import { Parser } from './Parser';

// This function looks for the "WORKSPACE" keyword in the query.
// It expects the next word to be either "work" or "learning".
export function parseWorkspace(p: Parser) {
	if (!p.peek('KEYWORD', 'WORKSPACE')) {
		return; // If the keyword isn't here, do nothing.
	}
	p.consume('KEYWORD', 'WORKSPACE');

	// Check if the next token is a valid workspace name.
	if (p.peek('WORD', 'work') || p.peek('WORD', 'learning')) {
		const token = p.consume('WORD');
		p.query.workspace = token.value; // Store "work" or "learning" in the query object.
	} else {
		// If the user wrote "WORKSPACE" but not "work" or "learning"
		throw p.error('Expected "work" or "learning" after WORKSPACE');
	}
}
