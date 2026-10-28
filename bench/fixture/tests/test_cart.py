import unittest

from shop.cart import Cart, checkout, total_price


class CartTest(unittest.TestCase):
    def test_total(self):
        c = Cart()
        c.add("apple", 2.0, 3)
        c.add("pear", 1.5)
        self.assertEqual(total_price(c), 7.5)

    def test_discount_at_exactly_100(self):
        c = Cart()
        c.add("tv", 100.0)
        self.assertEqual(checkout(c), 90.0)

    def test_no_discount(self):
        c = Cart()
        c.add("pen", 5.0, 2)
        self.assertEqual(checkout(c), 10.0)


if __name__ == "__main__":
    unittest.main()
