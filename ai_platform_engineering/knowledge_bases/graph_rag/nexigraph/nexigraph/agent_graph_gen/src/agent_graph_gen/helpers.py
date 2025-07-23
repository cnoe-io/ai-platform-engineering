
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


def is_accepted(confidence: (float|None), acceptance_threshold: float) -> bool:
    """
    Checks if the confidence is above the acceptance threshold.
    """
    if confidence is None:
        return False
    return confidence >= acceptance_threshold

def is_rejected(confidence: (float|None), rejection_threshold: float) -> bool:
    """
    Checks if the confidence is below the rejection threshold.
    """
    if confidence is None:
        return False
    return confidence <= rejection_threshold