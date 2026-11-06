"""Quant core: the statistical edge cases that decide whether a number means anything.

Every test here is about a case where a naive implementation returns a confident
number and the correct one returns ``None`` or a caveat.
"""

from __future__ import annotations

import math

import pytest

from wands.intelligence import quant


def test_the_t_distribution_matches_published_critical_values():
    # Two-sided 95% critical values from a standard table.
    assert quant.t_critical(1) == pytest.approx(12.7062, abs=1e-3)
    assert quant.t_critical(10) == pytest.approx(2.2281, abs=1e-3)
    assert quant.t_critical(30) == pytest.approx(2.0423, abs=1e-3)
    assert quant.t_critical(1000) == pytest.approx(1.9623, abs=1e-3)


def test_the_p_value_inverts_the_critical_value():
    assert quant.t_two_sided_p(2.2281, 10) == pytest.approx(0.05, abs=1e-3)
    assert quant.t_two_sided_p(0.0, 10) == pytest.approx(1.0, abs=1e-9)
    assert quant.t_two_sided_p(1.96, 1_000_000) == pytest.approx(0.05, abs=1e-3)


def test_an_empty_sample_reports_nothing_rather_than_zero():
    stats = quant.describe([])
    assert stats.count == 0
    assert stats.mean is None
    assert stats.hit_rate is None
    assert stats.small_sample is True


def test_missing_observations_are_dropped_not_treated_as_zero():
    stats = quant.describe([0.10, None, 0.20])
    assert stats.count == 2
    assert stats.mean == pytest.approx(0.15)


def test_a_sample_with_no_losses_has_no_profit_factor():
    # An infinite ratio is not a useful number to display or to sort by.
    stats = quant.describe([0.01, 0.02, 0.03])
    assert stats.profit_factor is None
    assert stats.average_loss is None
    assert stats.hit_rate == 1.0


def test_a_sample_with_no_gains_has_a_zero_profit_factor():
    stats = quant.describe([-0.01, -0.02])
    assert stats.profit_factor == 0.0
    assert stats.hit_rate == 0.0


def test_a_single_observation_has_no_interval():
    interval = quant.mean_confidence_interval([0.05])
    assert interval.lower is None
    assert interval.upper is None
    assert "At least two" in interval.note


def test_the_interval_widens_with_dispersion():
    tight = quant.mean_confidence_interval([0.01, 0.011, 0.009, 0.0105])
    wide = quant.mean_confidence_interval([-0.20, 0.30, -0.10, 0.25])
    assert (tight.upper - tight.lower) < (wide.upper - wide.lower)


def test_an_interval_that_excludes_zero_says_so():
    interval = quant.mean_confidence_interval([0.05, 0.051, 0.049, 0.0505, 0.052])
    assert interval.excludes_zero is True


def test_a_zero_variance_sample_has_no_test_statistic():
    result = quant.significance([0.01, 0.01, 0.01])
    assert result.t_statistic is None
    assert result.significant is False
    assert "no variance" in result.note


def test_significance_detects_a_clear_effect():
    sample = [0.05, 0.052, 0.048, 0.051, 0.049, 0.0505, 0.0495, 0.05]
    result = quant.significance(sample)
    assert result.significant is True
    assert result.p_value is not None and result.p_value < 0.05


def test_significance_does_not_detect_noise():
    sample = [0.05, -0.05, 0.04, -0.04, 0.03, -0.03]
    result = quant.significance(sample)
    assert result.significant is False


def test_the_bootstrap_is_seeded_and_reproducible():
    sample = [0.01, -0.02, 0.03, 0.005, -0.01, 0.02]
    first = quant.bootstrap_interval(sample, iterations=500, seed=7)
    second = quant.bootstrap_interval(sample, iterations=500, seed=7)
    third = quant.bootstrap_interval(sample, iterations=500, seed=8)

    assert (first.lower, first.upper) == (second.lower, second.upper)
    assert (first.lower, first.upper) != (third.lower, third.upper)


def test_max_drawdown_of_a_rising_curve_is_zero():
    result = quant.max_drawdown([1.0, 1.1, 1.2, 1.3])
    assert result.max_drawdown == 0.0


def test_max_drawdown_finds_the_worst_peak_to_trough():
    result = quant.max_drawdown([1.0, 1.2, 0.9, 1.1, 0.6])
    assert result.max_drawdown == pytest.approx(-0.5)
    assert result.peak_index == 1
    assert result.trough_index == 4


def test_max_drawdown_needs_two_points():
    assert quant.max_drawdown([1.0]).max_drawdown is None


def test_sharpe_is_undefined_without_variance():
    result = quant.sharpe_ratio([0.01, 0.01, 0.01])
    assert result.value is None
    assert result.appropriate is False


def test_sharpe_annualises_by_the_supplied_frequency():
    sample = [0.01, 0.02, -0.005, 0.015, 0.0]
    result = quant.sharpe_ratio(sample, periods_per_year=252)
    assert result.annualised == pytest.approx(result.value * math.sqrt(252))
    assert "overlapping" in result.note


def test_benchmark_relative_truncates_to_the_shorter_series():
    excess = quant.benchmark_relative([0.10, 0.20, 0.30], [0.05, 0.05])
    assert excess == pytest.approx([0.05, 0.15])


def test_benjamini_hochberg_matches_the_published_example():
    p_values = [0.001, 0.008, 0.039, 0.041, 0.042, 0.06, 0.074, 0.205, 0.212, 0.216]
    survivors = quant.benjamini_hochberg(p_values, alpha=0.05)
    assert survivors[:2] == [True, True]
    assert not any(survivors[2:])


def test_multiple_testing_reports_both_corrections():
    report = quant.multiple_testing_report([0.01, 0.02, 0.03, 0.04])
    assert report.tests == 4
    assert report.bonferroni_alpha == pytest.approx(0.0125)
    assert "expected by chance" in report.note


def test_multiple_testing_with_no_tests_is_explicit():
    report = quant.multiple_testing_report([])
    assert report.tests == 0
    assert report.note == "No tests were run."


def test_correlation_of_identical_series_is_one():
    assert quant.correlation([1, 2, 3, 4], [1, 2, 3, 4]) == pytest.approx(1.0)


def test_correlation_of_opposite_series_is_minus_one():
    assert quant.correlation([1, 2, 3, 4], [4, 3, 2, 1]) == pytest.approx(-1.0)


def test_correlation_needs_three_points():
    assert quant.correlation([1, 2], [1, 2]) is None


def test_equity_curve_compounds():
    curve = quant.equity_curve([0.10, -0.10])
    assert curve[0] == 1.0
    assert curve[-1] == pytest.approx(0.99)
