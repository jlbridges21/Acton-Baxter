/**
 * Calculated-field formulas: a small, safe expression language parsed into a tree and
 * evaluated deterministically. Nothing is ever passed to eval, SQL, or a JS engine.
 *
 *   Fields      item.price  job.projectedCost  sem:total_sqft  cf:22Pg…  calc:gross_profit
 *   Literals    12.5  "text"  TRUE  FALSE  NULL
 *   Operators   + - * / %   = != < <= > >=   AND OR NOT   & (join text)   ( )
 *   Functions   IF COALESCE ABS ROUND MIN MAX DIVIDE PERCENT DAYS_BETWEEN NUMBER TEXT
 *               ISBLANK CONTAINS YEAR MONTH
 *   Aggregates  SUM AVG MEDIAN COUNT COUNT_DISTINCT MIN(x) MAX(x)   (aggregate basis only)
 *
 * Semantics (financial-safe):
 *   - Blank (null) is not zero: arithmetic with a blank is blank; use COALESCE(x, 0) to treat
 *     blanks as zero explicitly.
 *   - Division by zero is blank, never Infinity or NaN.
 *   - "row" formulas compute one value per record. "aggregate" formulas aggregate first and
 *     then compute, e.g. (SUM(price) - SUM(cost)) / SUM(price) * 100 is a weighted margin,
 *     unlike AVG(calc:margin_pct), which averages per-record margins.
 */

import type { CellValue, Row } from "./compute";
import { asList, asNumber, isBlank } from "./compute";

export type FormulaBasis = "row" | "aggregate";
/** Value families used for type checking. */
export type ValueKind = "number" | "text" | "boolean" | "date" | "list" | "null";

export type FormulaNode =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "bool"; v: boolean }
  | { k: "null" }
  | { k: "field"; ref: string }
  | { k: "neg"; a: FormulaNode }
  | { k: "not"; a: FormulaNode }
  | { k: "bin"; op: BinOp; a: FormulaNode; b: FormulaNode }
  | { k: "call"; fn: string; args: FormulaNode[] };

type BinOp =
  "+" | "-" | "*" | "/" | "%" | "=" | "!=" | "<" | "<=" | ">" | ">=" | "and" | "or" | "&";

export const FORMULA_LIMITS = { length: 1000, nodes: 300, depth: 40 } as const;

export const SCALAR_FUNCTIONS: Record<string, { args: [number, number]; help: string }> = {
  IF: { args: [2, 3], help: "IF(condition, then, else) — else is blank when omitted" },
  COALESCE: { args: [1, 10], help: "COALESCE(a, b, …) — the first value that isn't blank" },
  ABS: { args: [1, 1], help: "ABS(x) — absolute value" },
  ROUND: { args: [1, 2], help: "ROUND(x, decimals) — decimals defaults to 0" },
  MIN: { args: [2, 10], help: "MIN(a, b, …) — smallest of several values" },
  MAX: { args: [2, 10], help: "MAX(a, b, …) — largest of several values" },
  DIVIDE: { args: [2, 2], help: "DIVIDE(a, b) — a ÷ b, blank when b is zero or blank" },
  PERCENT: { args: [2, 2], help: "PERCENT(part, whole) — part ÷ whole × 100" },
  DAYS_BETWEEN: { args: [2, 2], help: "DAYS_BETWEEN(start, end) — whole days from start to end" },
  NUMBER: { args: [1, 1], help: "NUMBER(x) — convert text to a number (blank if not numeric)" },
  TEXT: { args: [1, 1], help: "TEXT(x) — convert to text" },
  ISBLANK: { args: [1, 1], help: "ISBLANK(x) — TRUE when x has no value" },
  CONTAINS: { args: [2, 2], help: 'CONTAINS(text, "part") — case-insensitive' },
  YEAR: { args: [1, 1], help: "YEAR(date)" },
  MONTH: { args: [1, 1], help: "MONTH(date) — 1 to 12" },
};
export const AGGREGATE_FUNCTIONS: Record<string, { args: [number, number]; help: string }> = {
  SUM: { args: [1, 1], help: "SUM(x) — total of x across the records" },
  AVG: { args: [1, 1], help: "AVG(x) — average of x (blanks excluded)" },
  MEDIAN: { args: [1, 1], help: "MEDIAN(x)" },
  COUNT: { args: [0, 1], help: "COUNT() records, or COUNT(x) records where x isn't blank" },
  COUNT_DISTINCT: { args: [1, 1], help: "COUNT_DISTINCT(x) — distinct values of x" },
  MIN: { args: [1, 1], help: "MIN(x) — lowest x across the records" },
  MAX: { args: [1, 1], help: "MAX(x) — highest x across the records" },
};

export class FormulaError extends Error {}

// ── Tokenizer ────────────────────────────────────────────────────────────────────────────

type Token =
  | { t: "num"; v: number; at: number }
  | { t: "str"; v: string; at: number }
  | { t: "field"; v: string; at: number }
  | { t: "ident"; v: string; at: number }
  | { t: "op"; v: string; at: number };

const FIELD_RE =
  /^(?:(?:job|model|item|com)\.[a-zA-Z]+|cf:[A-Za-z0-9]{6,40}|sem:[a-z0-9_]{2,60}|calc:[a-z][a-z0-9_]{1,40})/;

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const rest = src.slice(i);
    const field = FIELD_RE.exec(rest);
    if (field) {
      out.push({ t: "field", v: field[0], at: i });
      i += field[0].length;
      continue;
    }
    const num = /^(?:\d+\.?\d*|\.\d+)/.exec(rest);
    if (num) {
      out.push({ t: "num", v: Number(num[0]), at: i });
      i += num[0].length;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      let s = "";
      while (j < src.length && src[j] !== ch) {
        if (src[j] === "\\" && j + 1 < src.length) j++;
        s += src[j];
        j++;
      }
      if (j >= src.length) throw new FormulaError(`Unclosed text starting at position ${i + 1}.`);
      out.push({ t: "str", v: s, at: i });
      i = j + 1;
      continue;
    }
    const ident = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
    if (ident) {
      out.push({ t: "ident", v: ident[0].toUpperCase(), at: i });
      i += ident[0].length;
      continue;
    }
    const op = /^(?:<=|>=|!=|<>|==|[-+*/%=<>(),&×÷])/.exec(rest);
    if (op) {
      const v = { "<>": "!=", "==": "=", "×": "*", "÷": "/" }[op[0]] ?? op[0];
      out.push({ t: "op", v, at: i });
      i += op[0].length;
      continue;
    }
    throw new FormulaError(`Unexpected "${ch}" at position ${i + 1}.`);
  }
  return out;
}

// ── Parser (precedence climbing) ─────────────────────────────────────────────────────────

export function parseFormula(src: string): FormulaNode {
  if (!src.trim()) throw new FormulaError("Enter a formula.");
  if (src.length > FORMULA_LIMITS.length)
    throw new FormulaError(`Formulas are limited to ${FORMULA_LIMITS.length} characters.`);
  const tokens = tokenize(src);
  let pos = 0;
  let nodes = 0;
  const peek = () => tokens[pos];
  const isOp = (v: string) => peek()?.t === "op" && peek()!.v === v;
  const isWord = (v: string) => peek()?.t === "ident" && peek()!.v === v;
  const node = <T extends FormulaNode>(n: T, depth: number): T => {
    if (++nodes > FORMULA_LIMITS.nodes) throw new FormulaError("This formula is too long.");
    if (depth > FORMULA_LIMITS.depth) throw new FormulaError("This formula is nested too deeply.");
    return n;
  };
  const expect = (v: string) => {
    if (!isOp(v)) {
      const t = peek();
      throw new FormulaError(
        t ? `Expected "${v}" at position ${t.at + 1}.` : `Expected "${v}" at the end.`,
      );
    }
    pos++;
  };

  const binary = (
    next: (d: number) => FormulaNode,
    ops: Array<[match: () => boolean, op: BinOp]>,
  ) =>
    function level(d: number): FormulaNode {
      let left = next(d + 1);
      for (;;) {
        const hit = ops.find(([m]) => m());
        if (!hit) return left;
        pos++;
        left = node({ k: "bin", op: hit[1], a: left, b: next(d + 1) }, d);
      }
    };

  const primary = (d: number): FormulaNode => {
    const t = peek();
    if (!t) throw new FormulaError("The formula ends too early.");
    if (t.t === "num") return (pos++, node({ k: "num", v: t.v }, d));
    if (t.t === "str") return (pos++, node({ k: "str", v: t.v }, d));
    if (t.t === "field") return (pos++, node({ k: "field", ref: t.v }, d));
    if (t.t === "op" && t.v === "(") {
      pos++;
      const inner = or(d + 1);
      expect(")");
      return inner;
    }
    if (t.t === "op" && t.v === "-") {
      pos++;
      return node({ k: "neg", a: unary(d + 1) }, d);
    }
    if (t.t === "ident") {
      pos++;
      if (t.v === "TRUE" || t.v === "FALSE") return node({ k: "bool", v: t.v === "TRUE" }, d);
      if (t.v === "NULL" || t.v === "BLANK") return node({ k: "null" }, d);
      if (!isOp("("))
        throw new FormulaError(
          `"${t.v}" isn't a field or function. Field references look like item.price, sem:total_sqft, or calc:gross_profit.`,
        );
      pos++;
      const args: FormulaNode[] = [];
      if (!isOp(")")) {
        args.push(or(d + 1));
        while (isOp(",")) {
          pos++;
          args.push(or(d + 1));
        }
      }
      expect(")");
      return node({ k: "call", fn: t.v, args }, d);
    }
    throw new FormulaError(`Unexpected "${t.v}" at position ${t.at + 1}.`);
  };
  const unary = (d: number): FormulaNode => primary(d);
  const mul = binary(unary, [
    [() => isOp("*"), "*"],
    [() => isOp("/"), "/"],
    [() => isOp("%"), "%"],
  ]);
  const add = binary(mul, [
    [() => isOp("+"), "+"],
    [() => isOp("-"), "-"],
  ]);
  const concat = binary(add, [[() => isOp("&"), "&"]]);
  const cmp = binary(concat, [
    [() => isOp("="), "="],
    [() => isOp("!="), "!="],
    [() => isOp("<="), "<="],
    [() => isOp(">="), ">="],
    [() => isOp("<"), "<"],
    [() => isOp(">"), ">"],
  ]);
  const not = (d: number): FormulaNode => {
    if (isWord("NOT")) {
      pos++;
      return node({ k: "not", a: not(d + 1) }, d);
    }
    return cmp(d);
  };
  const and = binary(not, [[() => isWord("AND"), "and"]]);
  const or = binary(and, [[() => isWord("OR"), "or"]]);

  const tree = or(0);
  if (pos < tokens.length) {
    const t = tokens[pos]!;
    throw new FormulaError(`Unexpected "${t.v}" at position ${t.at + 1}.`);
  }
  return tree;
}

// ── Analysis (fields, types, basis) ──────────────────────────────────────────────────────

export type ResolvedRef = {
  kind: ValueKind;
  label: string;
  /** An aggregate calculated field: usable as a whole value inside aggregate formulas only. */
  aggregate?: boolean;
};

export type FormulaAnalysis = {
  refs: string[];
  kind: ValueKind;
  /** True when the formula uses an aggregate function. */
  aggregates: boolean;
};

const NUMERIC = new Set<ValueKind>(["number", "null"]);

export function kindOfFieldType(type: string): ValueKind {
  if (["number", "currency", "percent", "sqft"].includes(type)) return "number";
  if (type === "date") return "date";
  if (type === "boolean") return "boolean";
  if (type === "list") return "list";
  return "text";
}

/**
 * Check fields, function names and arity, value types, and basis. `resolve` returns the
 * field's value kind or throws a FormulaError explaining why the field can't be used.
 */
export function analyzeFormula(
  tree: FormulaNode,
  basis: FormulaBasis,
  resolve: (ref: string) => ResolvedRef,
): FormulaAnalysis {
  const refs = new Set<string>();
  let aggregates = false;
  const walk = (n: FormulaNode, inAggregate: boolean): ValueKind => {
    switch (n.k) {
      case "num":
        return "number";
      case "str":
        return "text";
      case "bool":
        return "boolean";
      case "null":
        return "null";
      case "field": {
        const r = resolve(n.ref);
        refs.add(n.ref);
        if (r.aggregate) {
          if (basis === "row" || inAggregate)
            throw new FormulaError(
              `${r.label} is an aggregate calculation; it can only be used in an aggregate formula, outside SUM/AVG/….`,
            );
          return r.kind;
        }
        if (basis === "aggregate" && !inAggregate)
          throw new FormulaError(
            `In an aggregate formula, wrap ${r.label} (${n.ref}) in SUM, AVG, COUNT, MIN, or MAX.`,
          );
        return r.kind;
      }
      case "neg": {
        const k = walk(n.a, inAggregate);
        if (!NUMERIC.has(k)) throw new FormulaError("Only numbers can be negated.");
        return "number";
      }
      case "not":
        walk(n.a, inAggregate);
        return "boolean";
      case "bin": {
        const a = walk(n.a, inAggregate);
        const b = walk(n.b, inAggregate);
        if (["+", "-", "*", "/", "%"].includes(n.op)) {
          if (n.op === "-" && a === "date" && b === "date")
            throw new FormulaError("Use DAYS_BETWEEN(start, end) to subtract dates.");
          if (!NUMERIC.has(a) || !NUMERIC.has(b))
            throw new FormulaError(
              `"${n.op}" needs numbers on both sides${a === "text" || b === "text" ? " (use & to join text, or NUMBER() to convert)" : ""}.`,
            );
          return "number";
        }
        if (n.op === "&") return "text";
        if (n.op === "and" || n.op === "or") return "boolean";
        const family = (k: ValueKind) => (k === "list" ? "text" : k);
        if (a !== "null" && b !== "null" && family(a) !== family(b))
          throw new FormulaError(`Can't compare ${a} with ${b}.`);
        return "boolean";
      }
      case "call": {
        const agg = basis === "aggregate" ? AGGREGATE_FUNCTIONS[n.fn] : undefined;
        const isAggCall =
          agg && !(["MIN", "MAX"].includes(n.fn) && n.args.length > 1) && !inAggregate;
        if (AGGREGATE_FUNCTIONS[n.fn] && !SCALAR_FUNCTIONS[n.fn] && basis === "row")
          throw new FormulaError(
            `${n.fn}() aggregates across records; use an aggregate formula for that (or a row formula without it).`,
          );
        if (isAggCall) {
          if (inAggregate) throw new FormulaError("Aggregates can't be nested.");
          const [lo, hi] = agg.args;
          if (n.args.length < lo || n.args.length > hi) throw new FormulaError(`${agg.help}.`);
          aggregates = true;
          const kinds = n.args.map((a) => walk(a, true));
          if (["SUM", "AVG", "MEDIAN"].includes(n.fn) && !NUMERIC.has(kinds[0]!))
            throw new FormulaError(`${n.fn}() needs a number.`);
          return "number";
        }
        if (inAggregate && AGGREGATE_FUNCTIONS[n.fn] && !SCALAR_FUNCTIONS[n.fn])
          throw new FormulaError("Aggregates can't be nested.");
        const fn = SCALAR_FUNCTIONS[n.fn];
        if (!fn)
          throw new FormulaError(
            `Unknown function ${n.fn}(). Available: ${[...Object.keys(SCALAR_FUNCTIONS), ...(basis === "aggregate" ? Object.keys(AGGREGATE_FUNCTIONS) : [])].join(", ")}.`,
          );
        if (n.args.length < fn.args[0] || n.args.length > fn.args[1])
          throw new FormulaError(`${fn.help}.`);
        const kinds = n.args.map((a) => walk(a, inAggregate));
        const needNumbers = (idx: number[]) => {
          for (const i of idx)
            if (!NUMERIC.has(kinds[i]!)) throw new FormulaError(`${n.fn}() needs numbers.`);
        };
        switch (n.fn) {
          case "IF": {
            const branches = kinds.slice(1).filter((k) => k !== "null");
            const families = new Set(branches.map((k) => (k === "list" ? "text" : k)));
            if (families.size > 1)
              throw new FormulaError("IF() branches must return the same kind of value.");
            return branches[0] ?? "null";
          }
          case "COALESCE": {
            const ks = kinds.filter((k) => k !== "null");
            const families = new Set(ks.map((k) => (k === "list" ? "text" : k)));
            if (families.size > 1)
              throw new FormulaError("COALESCE() values must be the same kind of value.");
            return ks[0] ?? "null";
          }
          case "ABS":
          case "ROUND":
          case "MIN":
          case "MAX":
          case "DIVIDE":
          case "PERCENT":
            needNumbers(kinds.map((_, i) => i));
            return "number";
          case "DAYS_BETWEEN":
            for (const k of kinds)
              if (k !== "date" && k !== "text" && k !== "null")
                throw new FormulaError("DAYS_BETWEEN() needs two dates.");
            return "number";
          case "YEAR":
          case "MONTH":
          case "NUMBER":
            return "number";
          case "TEXT":
            return "text";
          case "ISBLANK":
          case "CONTAINS":
            return "boolean";
        }
        return "null";
      }
    }
  };
  const kind = walk(tree, false);
  if (basis === "aggregate" && !aggregates)
    throw new FormulaError(
      "An aggregate formula needs at least one SUM, AVG, COUNT, MIN, or MAX. For a per-record value, use a row formula.",
    );
  return { refs: [...refs], kind, aggregates };
}

// ── Evaluation ───────────────────────────────────────────────────────────────────────────

const clean = (n: number): number | null => (Number.isFinite(n) ? Math.round(n * 1e9) / 1e9 : null);

function toNumber(v: CellValue | undefined): number | null {
  if (typeof v === "boolean") return v ? 1 : 0;
  return asNumber(v);
}

function truthy(v: CellValue | undefined): boolean {
  if (isBlank(v)) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  return true;
}

function dayNumber(v: CellValue | undefined): number | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000;
}

function compare(a: CellValue | undefined, b: CellValue | undefined, op: BinOp): boolean | null {
  if (isBlank(a) || isBlank(b)) {
    if (op === "=") return isBlank(a) && isBlank(b);
    if (op === "!=") return !(isBlank(a) && isBlank(b));
    return null;
  }
  const na = typeof a === "number" ? a : null;
  const nb = typeof b === "number" ? b : null;
  let c: number;
  if (na !== null && nb !== null) c = na - nb;
  else {
    const sa = asList(a).join(", ").toLowerCase();
    const sb = asList(b).join(", ").toLowerCase();
    if (Array.isArray(a) && (op === "=" || op === "!=")) {
      const has = asList(a).some((x) => x.toLowerCase() === sb);
      return op === "=" ? has : !has;
    }
    c = sa < sb ? -1 : sa > sb ? 1 : 0;
  }
  switch (op) {
    case "=":
      return c === 0;
    case "!=":
      return c !== 0;
    case "<":
      return c < 0;
    case "<=":
      return c <= 0;
    case ">":
      return c > 0;
    default:
      return c >= 0;
  }
}

function aggregateValues(fn: string, values: CellValue[], rowCount: number): CellValue {
  if (fn === "COUNT") return values.length ? values.filter((v) => !isBlank(v)).length : rowCount;
  if (fn === "COUNT_DISTINCT") {
    const set = new Set<string>();
    for (const v of values) for (const s of asList(v)) set.add(s.toLowerCase());
    return set.size;
  }
  const nums = values.map(toNumber).filter((n): n is number => n !== null);
  if (!nums.length) return null;
  switch (fn) {
    case "SUM":
      return clean(nums.reduce((s, n) => s + n, 0));
    case "AVG":
      return clean(nums.reduce((s, n) => s + n, 0) / nums.length);
    case "MIN":
      return Math.min(...nums);
    case "MAX":
      return Math.max(...nums);
    case "MEDIAN": {
      const s = [...nums].sort((a, b) => a - b);
      const mid = Math.floor(s.length / 2);
      return s.length % 2 ? s[mid]! : clean((s[mid - 1]! + s[mid]!) / 2);
    }
  }
  return null;
}

/** Evaluates an aggregate calculated field over records (for calc refs in aggregate formulas). */
export type AggregateLookup = (ref: string, rows: Row[]) => CellValue;

type Env = { row: Row | null; rows: Row[] | null; lookup?: AggregateLookup };

function evalNode(n: FormulaNode, env: Env): CellValue {
  switch (n.k) {
    case "num":
      return n.v;
    case "str":
      return n.v;
    case "bool":
      return n.v;
    case "null":
      return null;
    case "field":
      if (env.row) return env.row[n.ref] ?? null;
      return env.rows && env.lookup ? env.lookup(n.ref, env.rows) : null;
    case "neg": {
      const v = toNumber(evalNode(n.a, env));
      return v === null ? null : -v;
    }
    case "not":
      return !truthy(evalNode(n.a, env));
    case "bin": {
      if (n.op === "and") return truthy(evalNode(n.a, env)) && truthy(evalNode(n.b, env));
      if (n.op === "or") return truthy(evalNode(n.a, env)) || truthy(evalNode(n.b, env));
      const a = evalNode(n.a, env);
      const b = evalNode(n.b, env);
      if (n.op === "&") return `${asList(a).join(", ")}${asList(b).join(", ")}`;
      if (["=", "!=", "<", "<=", ">", ">="].includes(n.op)) return compare(a, b, n.op);
      const x = toNumber(a);
      const y = toNumber(b);
      if (x === null || y === null) return null;
      switch (n.op) {
        case "+":
          return clean(x + y);
        case "-":
          return clean(x - y);
        case "*":
          return clean(x * y);
        case "/":
          return y === 0 ? null : clean(x / y);
        case "%":
          return y === 0 ? null : clean(x % y);
      }
      return null;
    }
    case "call": {
      const aggregateCall =
        env.rows &&
        AGGREGATE_FUNCTIONS[n.fn] &&
        !(["MIN", "MAX"].includes(n.fn) && n.args.length > 1);
      if (aggregateCall) {
        const rows = env.rows!;
        const values = n.args.length
          ? rows.map((row) => evalNode(n.args[0]!, { row, rows: null }))
          : [];
        return aggregateValues(n.fn, values, rows.length);
      }
      const arg = (i: number) => evalNode(n.args[i]!, env);
      switch (n.fn) {
        case "IF":
          return truthy(arg(0)) ? arg(1) : n.args.length > 2 ? arg(2) : null;
        case "COALESCE":
          for (let i = 0; i < n.args.length; i++) {
            const v = arg(i);
            if (!isBlank(v)) return v;
          }
          return null;
        case "ABS": {
          const v = toNumber(arg(0));
          return v === null ? null : Math.abs(v);
        }
        case "ROUND": {
          const v = toNumber(arg(0));
          const d = n.args.length > 1 ? toNumber(arg(1)) : 0;
          if (v === null || d === null) return null;
          const f = 10 ** Math.max(0, Math.min(6, Math.trunc(d)));
          return Math.round(v * f) / f;
        }
        case "MIN":
        case "MAX": {
          const vs = n.args.map((_, i) => toNumber(arg(i)));
          if (vs.some((v) => v === null)) return null;
          return n.fn === "MIN" ? Math.min(...(vs as number[])) : Math.max(...(vs as number[]));
        }
        case "DIVIDE":
        case "PERCENT": {
          const a = toNumber(arg(0));
          const b = toNumber(arg(1));
          if (a === null || b === null || b === 0) return null;
          return clean((a / b) * (n.fn === "PERCENT" ? 100 : 1));
        }
        case "DAYS_BETWEEN": {
          const a = dayNumber(arg(0));
          const b = dayNumber(arg(1));
          return a === null || b === null ? null : Math.round(b - a);
        }
        case "NUMBER": {
          const v = arg(0);
          if (typeof v === "string") {
            const parsed = Number(v.replace(/[$,%\s]/g, ""));
            return v.trim() && Number.isFinite(parsed) ? parsed : null;
          }
          return toNumber(v);
        }
        case "TEXT": {
          const v = arg(0);
          return isBlank(v) ? null : asList(v).join(", ") || String(v);
        }
        case "ISBLANK":
          return isBlank(arg(0));
        case "CONTAINS": {
          const hay = asList(arg(0)).join(" ").toLowerCase();
          const needle = asList(arg(1)).join(" ").toLowerCase();
          return needle ? hay.includes(needle) : false;
        }
        case "YEAR":
        case "MONTH": {
          const v = arg(0);
          const m = typeof v === "string" ? /^(\d{4})-(\d{2})/.exec(v) : null;
          return m ? Number(n.fn === "YEAR" ? m[1] : m[2]) : null;
        }
      }
      return null;
    }
  }
}

/** One value for one record (row formulas). */
export function evaluateRow(tree: FormulaNode, row: Row): CellValue {
  return evalNode(tree, { row, rows: null });
}

/** One value for a set of records (aggregate formulas): aggregates first, then the math. */
export function evaluateAggregate(
  tree: FormulaNode,
  rows: Row[],
  lookup?: AggregateLookup,
): CellValue {
  return evalNode(tree, { row: null, rows, lookup });
}

/** Every calc:* reference in a formula (for dependency ordering and cycle checks). */
export function calcRefs(tree: FormulaNode): string[] {
  const out = new Set<string>();
  const walk = (n: FormulaNode) => {
    if (n.k === "field" && n.ref.startsWith("calc:")) out.add(n.ref);
    if (n.k === "neg" || n.k === "not") walk(n.a);
    if (n.k === "bin") {
      walk(n.a);
      walk(n.b);
    }
    if (n.k === "call") n.args.forEach(walk);
  };
  walk(tree);
  return [...out];
}
