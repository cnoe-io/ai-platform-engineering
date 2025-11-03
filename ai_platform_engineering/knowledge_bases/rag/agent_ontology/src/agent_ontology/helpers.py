
from itertools import combinations


def generate_combinations_with_constant(arr, constant):
    """
    Generates all combinations of the elements in the array with a constant value at the beginning.
    """
    # Remove the constant value from the array
    remaining_values = [x for x in arr if x != constant]

    # Initialize result list
    result = []

    # Generate combinations of all sizes for the remaining values
    for r in range(1, len(remaining_values) + 1):
        # Generate combinations of length 'r'
        for comb in combinations(remaining_values, r):
            # Add the constant value at the beginning of each combination
            result.append([constant] + list(comb))

    return result
