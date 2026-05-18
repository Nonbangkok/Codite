#include "math_utils.hpp"

template <typename T>
T max_val(T a, T b) {
    return (a > b) ? a : b;
}

int main() {
    utils::Calculator calc;
    calc.add(2, 3);
    return 0;
}
