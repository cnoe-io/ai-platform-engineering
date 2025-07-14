from agentevals.graph_trajectory.utils import (
  extract_langgraph_trajectory_from_thread,
)
from agentevals.graph_trajectory.strict import graph_trajectory_strict_match_async

from agent_argocd.graph import graph

import pprint
import pytest
import asyncio
import uuid
from tabulate import tabulate
from datetime import datetime
import yaml
import argparse


def format_results(results):
  output = "# Evaluation Results\n\n"
  correct = sum(1 for result in results if result.get("score", False))
  total = len(results)
  accuracy = correct / total if total > 0 else 0
  output += f"## Accuracy: {accuracy:.2%}\n\n"
  return output


def print_banner(title, obj):
  print("=" * 80)
  print(title)
  pprint.pprint(obj)
  print("=" * 80)


def read_yaml(file_path):
  with open(file_path, "r", encoding="utf-8") as file:
    data = yaml.safe_load(file)
    return data


@pytest.mark.langsmith
async def eval_strict(test_ids=None):
  data = read_yaml("./evals/strict_match/strict_match_dataset.yaml")

  # Filter tests by test_ids
  if test_ids:
    test_ids = set(test_ids.split(","))
    data["tests"] = {k: v for k, v in data["tests"].items() if k in test_ids}

  # Extract the prompts, reference trajectories, and notes from the dataset
  test_ids_list = list(data["tests"].keys())
  prompts = [test["input"] for test in data["tests"].values()]
  reference_trajectories = [
    [sol.replace("\n", "").split(";") for sol in test["reference_trajectory"].values()]
    for test in data["tests"].values()
  ]
  notes = [test["metadata"]["comments"] for test in data["tests"].values()]

  # Run the evaluation
  results = []
  print(list(zip(test_ids_list, prompts, reference_trajectories, notes)))
  for test_id, each_prompt, each_reference_trajectories, each_note in zip(
    test_ids_list, prompts, reference_trajectories, notes
  ):
    print("#" * 80)
    print(f"Test ID: {test_id}")
    print(f"Prompt: {each_prompt}")
    print(f"Reference Trajectories: {each_reference_trajectories}")
    print(f"Note: {each_note}")
    print("#" * 80)
    # Generate a unique thread ID
    thread_id = uuid.uuid4().hex
    await graph.ainvoke(
      {
        "messages": [{"role": "user", "content": each_prompt}],
        "argocd_input": {},  # Provide an appropriate value if required by your agent
      },
      config={"configurable": {"thread_id": thread_id, "user_files": [], "user_sandbox": "sandbox-noone"}},
    )
    extracted_trajectory = extract_langgraph_trajectory_from_thread(
      graph, {"configurable": {"thread_id": thread_id, "user_files": [], "user_sandbox": "sandbox-noone"}}
    )
    print_banner("Extracted Trajectory:", extracted_trajectory)

    score = False
    for each_reference_trajectory in each_reference_trajectories:
      print_banner("Reference Trajectory:", each_reference_trajectory)
      res = await graph_trajectory_strict_match_async(
        outputs=extracted_trajectory["outputs"],
        reference_outputs={"results": [], "steps": [each_reference_trajectory]},
      )
      print_banner("Results:", res)
      if res["score"]:
        score = True
        break

    results.append(
      {
        "test_id": test_id,
        "prompt": each_prompt,
        "score": score,
        "extracted": extracted_trajectory["outputs"]["steps"],
        "reference": each_reference_trajectories,
        "note": each_note,
      }
    )

  ########################################
  #  Write the results to a README file  #
  ########################################

  headers = ["Test ID", "Prompt", "Score", "Extracted Trajectory", "Reference Trajectories", "Notes"]
  table = [
    [result["test_id"], result["prompt"], result["score"], result["extracted"], result["reference"], result["note"]]
    for result in results
  ]
  current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
  with open("./evals/strict_match/README.md", "w", encoding="utf-8") as readme_file:
    readme_file.write(f"## Evaluation Date: {current_time}\n\n")
    readme_file.write(format_results(results))
    readme_file.write("\n\n")
    readme_file.write(tabulate(table, headers=headers, tablefmt="github"))
  # Print the accuracy table to stdout
  print(format_results(results))
  print(tabulate(table, headers=headers, tablefmt="github"))


if __name__ == "__main__":
  parser = argparse.ArgumentParser(description="Run strict match evaluation.")
  parser.add_argument("--test_ids", type=str, help="Comma-separated list of test IDs to run.")
  args = parser.parse_args()
  asyncio.run(eval_strict(test_ids=args.test_ids))
