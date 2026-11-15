import pytest

from app.mathtools import MATH_TOOLS, compare_expressions, search_counterexample


def test_finds_the_smallest_counterexample():
    result = search_counterexample("n", "n**2 % 4 == 0", "n % 4 == 0")
    assert result.startswith("COUNTEREXAMPLE: n = 2.")


def test_reports_no_counterexample_as_evidence_not_proof():
    result = search_counterexample("n", "n**2 % 2 == 0", "n % 2 == 0")
    assert result.startswith("NO COUNTEREXAMPLE")
    assert "not a proof" in result


def test_searches_over_several_variables():
    # "If a + b is even then a and b are both even" fails for two odd numbers.
    result = search_counterexample("a, b", "(a + b) % 2 == 0", "a % 2 == 0 and b % 2 == 0")
    assert result.startswith("COUNTEREXAMPLE")
    assert "a = 1" in result or "a = -1" in result


def test_accepts_a_caret_for_powers():
    assert search_counterexample("n", "True", "n^2 >= 0").startswith("NO COUNTEREXAMPLE")


def test_says_when_the_hypothesis_never_holds():
    assert "never holds" in search_counterexample("n", "n != n", "n == 0")


@pytest.mark.parametrize(
    "expression",
    [
        "__import__('os').system('true')",
        "n.__class__",
        "open('/etc/passwd')",
        "[n for n in range(3)]",
        "(lambda: 1)()",
        "n ** 9999",
        "'text'",
    ],
)
def test_rejects_anything_that_is_not_plain_integer_arithmetic(expression):
    assert search_counterexample("n", expression, "True").startswith("COULD NOT CHECK")
    assert search_counterexample("n", "True", expression).startswith("COULD NOT CHECK")


def test_rejects_bad_variable_lists_and_huge_ranges():
    assert search_counterexample("", "True", "True").startswith("COULD NOT CHECK")
    assert search_counterexample("a, b, c, d", "True", "True").startswith("COULD NOT CHECK")
    assert search_counterexample("a, b, c", "True", "True", -100, 100).startswith("COULD NOT CHECK")


def test_division_by_zero_cases_are_skipped():
    assert search_counterexample("n", "10 % n == 0", "n != 0").startswith("NO COUNTEREXAMPLE")


def test_confirms_an_algebraic_identity():
    assert compare_expressions("(a + b)^2", "a**2 + 2*a*b + b**2").startswith("EQUAL")
    assert compare_expressions("4*k**2 + 4*k + 1", "2*(2*k**2 + 2*k) + 1").startswith("EQUAL")


def test_shows_where_two_expressions_differ():
    result = compare_expressions("(a + b)**2", "a**2 + b**2")
    assert result.startswith("NOT EQUAL")
    assert "a = " in result


def test_square_root_of_a_square_is_not_the_number_itself():
    assert compare_expressions("sqrt(x**2)", "x").startswith("NOT EQUAL")


@pytest.mark.parametrize("expression", ["x.real", "__import__('os')", "exec('1')", "x[0]", "x ** 1000"])
def test_symbolic_check_rejects_unsafe_or_oversized_input(expression):
    assert compare_expressions(expression, "x").startswith("COULD NOT CHECK")


def test_tools_expose_the_same_checks_to_an_agent():
    tools = {tool.name: tool for tool in MATH_TOOLS}
    assert set(tools) == {"find_counterexample", "check_identity"}
    result = tools["find_counterexample"].invoke({"variables": "n", "hypothesis": "n**2 % 4 == 0", "conclusion": "n % 4 == 0"})
    assert result.startswith("COUNTEREXAMPLE")
    assert tools["check_identity"].invoke({"left": "2*(m + n)", "right": "2*m + 2*n"}).startswith("EQUAL")
