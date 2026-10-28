"""A shopping cart: line items, totals and a volume discount."""


class Cart:
    def __init__(self):
        self.items = []  # (name, unit_price, quantity)

    def add(self, name, unit_price, quantity=1):
        if quantity <= 0:
            raise ValueError("quantity must be positive")
        self.items.append((name, unit_price, quantity))

    def remove(self, name):
        self.items = [i for i in self.items if i[0] != name]


def total_price(cart):
    return sum(price * qty for _, price, qty in cart.items)


def discount(subtotal):
    """10% off orders of 100 or more, 20% off orders of 500 or more."""
    if subtotal > 500:
        return subtotal * 0.2
    if subtotal > 100:
        return subtotal * 0.1
    return 0


def checkout(cart):
    subtotal = total_price(cart)
    return round(subtotal - discount(subtotal), 2)
