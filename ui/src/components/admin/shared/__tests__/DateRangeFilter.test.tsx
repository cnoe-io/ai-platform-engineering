import { fireEvent, render, screen } from "@testing-library/react";
import { DateRangeFilter } from "../DateRangeFilter";

describe("DateRangeFilter", () => {
  it("applies custom dates at local day boundaries", () => {
    const onChange = jest.fn();
    render(<DateRangeFilter value="24h" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: /custom/i }));
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-06-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-06-03" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    const [, range] = onChange.mock.calls[0];
    const from = new Date(range.from);
    const to = new Date(range.to);
    expect([from.getFullYear(), from.getMonth(), from.getDate(), from.getHours()]).toEqual([
      2026,
      5,
      1,
      0,
    ]);
    expect([
      to.getFullYear(),
      to.getMonth(),
      to.getDate(),
      to.getHours(),
      to.getMinutes(),
      to.getSeconds(),
      to.getMilliseconds(),
    ]).toEqual([2026, 5, 3, 23, 59, 59, 999]);
  });

  it("does not apply an inverted custom range", () => {
    const onChange = jest.fn();
    render(<DateRangeFilter value="24h" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: /custom/i }));
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-06-03" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-06-01" } });

    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
  });
});
