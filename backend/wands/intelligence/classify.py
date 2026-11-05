"""Transaction classification.

The single most important decision in this subsystem is what counts as an
open-market purchase. A Form 4 reports many things that move shares: a grant, a
gift, a tax withholding, the exercise of an option. Only code ``P`` on a
non-derivative security, acquired, is a person choosing to buy stock in the
market at a price.

Everything else is classified honestly and kept out of purchase aggregates. A
signal built on awards would look like insider confidence and mean nothing.
"""

from __future__ import annotations

from wands.intelligence.base import ParsedTransaction, TransactionClass

# The SEC's own definitions, kept here so an explanation string can quote the
# source rather than paraphrase it.
CODE_MEANINGS: dict[str, str] = {
    "P": "Open market or private purchase of a non-derivative or derivative security",
    "S": "Open market or private sale of a non-derivative or derivative security",
    "A": "Grant, award or other acquisition pursuant to Rule 16b-3(d)",
    "D": "Disposition to the issuer of the security",
    "F": "Payment of exercise price or tax liability by delivering or withholding securities",
    "I": "Discretionary transaction",
    "M": "Exercise or conversion of a derivative security exempted pursuant to Rule 16b-3",
    "C": "Conversion of a derivative security",
    "G": "Bona fide gift",
    "J": "Other acquisition or disposition",
    "K": "Transaction in an equity swap",
    "L": "Small acquisition",
    "U": "Disposition pursuant to a tender of shares in a change of control",
    "V": "Transaction voluntarily reported earlier than required",
    "W": "Acquisition or disposition by will or laws of descent and distribution",
    "X": "Exercise of an in-the-money or at-the-money derivative security",
    "Z": "Deposit into or withdrawal from a voting trust",
    "E": "Expiration of a short derivative position",
    "H": "Expiration of a long derivative position with value received",
    "O": "Exercise of an out-of-the-money derivative security",
    "T": "Acquisition or disposition pursuant to a tender offer",
}

# Codes that describe the settlement of a derivative position rather than a
# decision to trade the underlying in the market.
_DERIVATIVE_CODES = frozenset({"M", "C", "X", "O", "E", "H"})


def classify(transaction: ParsedTransaction) -> TransactionClass:
    """Classify one reported line.

    A derivative-table row is never an open-market purchase of the common stock,
    even when its code is ``P``: it is a purchase of a different instrument with
    different economics. Treating it as insider buying would overstate the
    signal, so it is classified as ``OTHER``.
    """
    code = (transaction.transaction_code or "").strip().upper()
    acquired = (transaction.acquired_disposed or "").strip().upper()

    if transaction.is_derivative:
        if code in _DERIVATIVE_CODES:
            return TransactionClass.DERIVATIVE_EXERCISE
        if code == "A":
            return TransactionClass.AWARD_GRANT
        if code == "G":
            return TransactionClass.GIFT
        if code == "F":
            return TransactionClass.TAX_WITHHOLDING
        return TransactionClass.OTHER

    # A purchase must be an acquisition and a sale must be a disposition. A
    # filing that says otherwise is internally inconsistent, and guessing which
    # half is right would be inventing a fact.
    if code == "P" and acquired == "A":
        return TransactionClass.OPEN_MARKET_PURCHASE
    if code == "S" and acquired == "D":
        return TransactionClass.OPEN_MARKET_SALE
    if code in {"P", "S"}:
        return TransactionClass.OTHER

    if code == "A":
        return TransactionClass.AWARD_GRANT
    if code == "F":
        return TransactionClass.TAX_WITHHOLDING
    if code == "G":
        return TransactionClass.GIFT
    if code == "D":
        return TransactionClass.DISPOSITION_TO_ISSUER
    if code in _DERIVATIVE_CODES:
        # The shares received when an option is exercised. Real, but not a
        # market purchase.
        return TransactionClass.DERIVATIVE_EXERCISE
    return TransactionClass.OTHER


def is_open_market(classification: TransactionClass) -> bool:
    return classification in {
        TransactionClass.OPEN_MARKET_PURCHASE,
        TransactionClass.OPEN_MARKET_SALE,
    }


def describe(transaction: ParsedTransaction, classification: TransactionClass) -> str:
    """A one-line, source-faithful description for the feed and for signals."""
    code = (transaction.transaction_code or "").strip().upper()
    meaning = CODE_MEANINGS.get(code, "Unrecognised transaction code")
    if classification is TransactionClass.OPEN_MARKET_PURCHASE:
        return f"Open-market purchase (code P): {meaning}."
    if classification is TransactionClass.OPEN_MARKET_SALE:
        return f"Open-market sale (code S): {meaning}."
    if classification is TransactionClass.AWARD_GRANT:
        return f"Grant or award (code {code or 'n/a'}): {meaning}. Not a market purchase."
    if classification is TransactionClass.TAX_WITHHOLDING:
        return (
            f"Tax withholding or exercise-price payment (code {code or 'n/a'}): "
            f"{meaning}. Not a market sale."
        )
    if classification is TransactionClass.GIFT:
        return f"Gift (code {code or 'n/a'}): {meaning}. No market price is involved."
    if classification is TransactionClass.DERIVATIVE_EXERCISE:
        return (
            f"Derivative exercise or conversion (code {code or 'n/a'}): {meaning}. "
            "Not an open-market purchase of the underlying."
        )
    if classification is TransactionClass.DISPOSITION_TO_ISSUER:
        return f"Disposition to the issuer (code {code or 'n/a'}): {meaning}."
    return f"Other reported transaction (code {code or 'n/a'}): {meaning}."
