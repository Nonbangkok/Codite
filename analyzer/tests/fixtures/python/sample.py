import os
from datetime import datetime

class MyClass:
    def __init__(self, x):
        self.x = x
    
    def my_method(self):
        return self.x

    def __str__(self):
        return f"MyClass({self.x})"

def my_function():
    pass

def decorated_function():
    pass
