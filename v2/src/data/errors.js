// Turns raw database errors into something a person can act on.
//
// "Out of date" is only claimed for a missing table, column or app function: the signature of a
// SQL file that has not been run yet. Any other "does not exist" (for example a missing Postgres
// built-in used inside a function) is a real bug, so it is shown as it is rather than hidden
// behind advice that would send people to re-run SQL that is already applied.
const OUT_OF_DATE = new RegExp([
  String.raw`\b(column|relation|table)\b.*?\bdoes not exist`,
  String.raw`could not find the (table|column|function)\b.*?schema cache`,
].join('|'), 'i');

export function friendlyDataError(message = '') {
  if (OUT_OF_DATE.test(message)) {
    return 'The database is out of date. Run the newest SQL files from the db folder in Supabase (SQL Editor), then reload this page.';
  }
  return message;
}
