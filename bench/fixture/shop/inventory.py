"""Stock levels for the shop."""

STOCK = {"apple": 12, "banana": 3, "cherry": 0, "dates": 40}


def in_stock(name):
    return STOCK.get(name, 0) > 0


def restock(name, amount):
    STOCK[name] = STOCK.get(name, 0) + amount
    return STOCK[name]
