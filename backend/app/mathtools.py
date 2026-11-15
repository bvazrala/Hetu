"""Deterministic checks for the mathematics specialist.

The expressions come from a language model, which was in turn prompted by a
student, so they are untrusted text. Nothing here is passed to `eval`,
`sympify`, or `parse_expr`, all of which can run arbitrary code. Each
expression is parsed into a syntax tree, and only a short list of node kinds
is accepted.

These checks give exact answers to narrow questions. A search that finds no
counterexample is evidence, not a proof, and the results say so.
"""

import ast
import itertools
import math
from collections.abc import Callable

import sympy
from langchain_core.tools import tool

MAX_EXPRESSION_CHARS = 300
MAX_NODES = 80
MAX_EXPONENT = 12
MAX_CASES = 70_000


class UnsupportedExpression(ValueError):
    """The expression uses something these checks do not accept."""


def _parse(source: str) -> ast.expr:
    if len(source) > MAX_EXPRESSION_CHARS:
        raise UnsupportedExpression("the expression is too long")
    try:
        tree = ast.parse(source.strip().replace("^", "**"), mode="eval")
    except SyntaxError:
        raise UnsupportedExpression(f"could not read {source!r}") from None
    if sum(1 for _ in ast.walk(tree)) > MAX_NODES:
        raise UnsupportedExpression("the expression is too large")
    return tree.body


_INTEGER_FUNCTIONS: dict[str, Callable[..., int]] = {"abs": abs, "gcd": math.gcd, "min": min, "max": max}

_COMPARISONS: dict[type, Callable[[int, int], bool]] = {
    ast.Eq: lambda a, b: a == b,
    ast.NotEq: lambda a, b: a != b,
    ast.Lt: lambda a, b: a < b,
    ast.LtE: lambda a, b: a <= b,
    ast.Gt: lambda a, b: a > b,
    ast.GtE: lambda a, b: a >= b,
}


def _evaluate(node: ast.expr, values: dict[str, int]) -> int | bool:
    """Evaluate an integer expression or a condition by walking its syntax tree."""
    if isinstance(node, ast.Constant) and isinstance(node.value, int):
        return node.value
    if isinstance(node, ast.Name):
        if node.id not in values:
            raise UnsupportedExpression(f"unknown name {node.id!r}")
        return values[node.id]
    if isinstance(node, ast.UnaryOp):
        operand = _evaluate(node.operand, values)
        if isinstance(node.op, ast.USub):
            return -operand
        if isinstance(node.op, ast.UAdd):
            return operand
        if isinstance(node.op, ast.Not):
            return not operand
    if isinstance(node, ast.BinOp):
        left, right = _evaluate(node.left, values), _evaluate(node.right, values)
        if isinstance(node.op, ast.Add):
            return left + right
        if isinstance(node.op, ast.Sub):
            return left - right
        if isinstance(node.op, ast.Mult):
            return left * right
        if isinstance(node.op, ast.FloorDiv):
            return left // right
        if isinstance(node.op, ast.Mod):
            return left % right
        if isinstance(node.op, ast.Pow):
            # Without a cap, a single expression could tie up the server.
            if not 0 <= right <= MAX_EXPONENT:
                raise UnsupportedExpression(f"exponents must be between 0 and {MAX_EXPONENT}")
            return left**right
        if isinstance(node.op, ast.Div):
            raise UnsupportedExpression("use // for integer division or % for remainders")
    if isinstance(node, ast.Compare):
        left = _evaluate(node.left, values)
        for operator, comparator in zip(node.ops, node.comparators, strict=True):
            compare = _COMPARISONS.get(type(operator))
            if compare is None:
                raise UnsupportedExpression("unsupported comparison")
            right = _evaluate(comparator, values)
            if not compare(left, right):
                return False
            left = right
        return True
    if isinstance(node, ast.BoolOp):
        results = [bool(_evaluate(value, values)) for value in node.values]
        return all(results) if isinstance(node.op, ast.And) else any(results)
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and not node.keywords:
        function = _INTEGER_FUNCTIONS.get(node.func.id)
        if function is not None:
            return function(*[_evaluate(argument, values) for argument in node.args])
    raise UnsupportedExpression("only integers, + - * // % **, comparisons, and/or/not, abs, gcd, min, max are accepted")


def search_counterexample(variables: str, hypothesis: str, conclusion: str, low: int = -20, high: int = 20) -> str:
    """Try every integer assignment in range, looking for one where the hypothesis holds and the conclusion fails."""
    names = [name.strip() for name in variables.split(",") if name.strip()]
    if not 1 <= len(names) <= 3 or not all(name.isidentifier() for name in names):
        return "COULD NOT CHECK: give one to three variable names separated by commas."
    if low > high:
        low, high = high, low
    width = high - low + 1
    if width ** len(names) > MAX_CASES:
        return f"COULD NOT CHECK: the range is too large. Use at most {MAX_CASES} combinations."

    try:
        hypothesis_tree, conclusion_tree = _parse(hypothesis), _parse(conclusion)
        applicable = 0
        # Small numbers first, so the counterexample reported is the simplest one.
        candidates = sorted(range(low, high + 1), key=lambda value: (abs(value), value < 0))
        for combination in itertools.product(candidates, repeat=len(names)):
            values = dict(zip(names, combination, strict=True))
            try:
                if not _evaluate(hypothesis_tree, values):
                    continue
                applicable += 1
                if not _evaluate(conclusion_tree, values):
                    found = ", ".join(f"{name} = {value}" for name, value in values.items())
                    return f"COUNTEREXAMPLE: {found}. The hypothesis holds and the conclusion fails."
            except ZeroDivisionError:
                continue
    except UnsupportedExpression as error:
        return f"COULD NOT CHECK: {error}."

    if applicable == 0:
        return f"COULD NOT CHECK: the hypothesis never holds for integers from {low} to {high}."
    return (
        f"NO COUNTEREXAMPLE for integers from {low} to {high} "
        f"({applicable} cases where the hypothesis holds). This is evidence, not a proof."
    )


_SYMBOLIC_FUNCTIONS: dict[str, Callable[..., sympy.Expr]] = {
    "sqrt": sympy.sqrt,
    "sin": sympy.sin,
    "cos": sympy.cos,
    "tan": sympy.tan,
    "exp": sympy.exp,
    "log": sympy.log,
    "ln": sympy.log,
    "abs": sympy.Abs,
}
_SYMBOLIC_CONSTANTS: dict[str, sympy.Expr] = {"pi": sympy.pi, "e": sympy.E}


def _to_sympy(node: ast.expr) -> sympy.Expr:
    """Build a SymPy expression from a syntax tree, accepting arithmetic and a few named functions."""
    if isinstance(node, ast.Constant) and isinstance(node.value, int | float) and not isinstance(node.value, bool):
        return sympy.Rational(str(node.value))
    if isinstance(node, ast.Name):
        return _SYMBOLIC_CONSTANTS.get(node.id, sympy.Symbol(node.id))
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub | ast.UAdd):
        operand = _to_sympy(node.operand)
        return -operand if isinstance(node.op, ast.USub) else operand
    if isinstance(node, ast.BinOp):
        left, right = _to_sympy(node.left), _to_sympy(node.right)
        if isinstance(node.op, ast.Add):
            return left + right
        if isinstance(node.op, ast.Sub):
            return left - right
        if isinstance(node.op, ast.Mult):
            return left * right
        if isinstance(node.op, ast.Div):
            return left / right
        if isinstance(node.op, ast.Pow):
            if right.is_number and abs(right) > 50:
                raise UnsupportedExpression("the exponent is too large")
            return left**right
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and len(node.args) == 1 and not node.keywords:
        function = _SYMBOLIC_FUNCTIONS.get(node.func.id)
        if function is not None:
            return function(_to_sympy(node.args[0]))
    raise UnsupportedExpression("only numbers, variables, + - * / **, sqrt, sin, cos, tan, exp, log, abs are accepted")


def compare_expressions(left: str, right: str) -> str:
    """Decide whether two algebraic expressions are equal for all values of their variables."""
    try:
        difference = _to_sympy(_parse(left)) - _to_sympy(_parse(right))
        if sympy.simplify(difference) == 0:
            return "EQUAL: the two expressions agree for all values. This was checked symbolically."
        symbols = sorted(difference.free_symbols, key=str)
        # Simplification can fail to reduce a zero expression, so a nonzero
        # result is confirmed with actual numbers before it is reported.
        for sample in ([2, 3, 5], [-1, 4, 7], [10, -3, 2]):
            values = dict(zip(symbols, itertools.cycle(sample), strict=False))
            gap = difference.subs(values)
            if gap.is_number and abs(sympy.N(gap)) > 1e-9:
                at = ", ".join(f"{symbol} = {value}" for symbol, value in values.items()) or "these constants"
                return f"NOT EQUAL: the expressions differ, for example at {at}."
    except UnsupportedExpression as error:
        return f"COULD NOT CHECK: {error}."
    except (ZeroDivisionError, ValueError, TypeError, ArithmeticError):
        return "COULD NOT CHECK: the expressions could not be evaluated."
    return "COULD NOT DECIDE: the expressions were not shown to be equal or different."


@tool
def find_counterexample(variables: str, hypothesis: str, conclusion: str, low: int = -20, high: int = 20) -> str:
    """Search integers for a counterexample to "if hypothesis then conclusion".

    Use Python syntax for integers: + - * // % **, comparisons, and/or/not, abs, gcd.
    Example: variables="n", hypothesis="n**2 % 4 == 0", conclusion="n % 4 == 0".
    Use hypothesis="True" for a claim about all integers.
    The result starts with COUNTEREXAMPLE, NO COUNTEREXAMPLE, or COULD NOT CHECK.
    Finding no counterexample is evidence, never a proof.
    """
    return search_counterexample(variables, hypothesis, conclusion, low, high)


@tool
def check_identity(left: str, right: str) -> str:
    """Check symbolically whether two algebraic expressions are equal for all values.

    Use Python syntax: + - * / **, sqrt(x), sin(x), exp(x), log(x).
    Example: left="(a + b)**2", right="a**2 + 2*a*b + b**2".
    The result starts with EQUAL, NOT EQUAL, COULD NOT DECIDE, or COULD NOT CHECK.
    """
    return compare_expressions(left, right)


MATH_TOOLS = [find_counterexample, check_identity]
