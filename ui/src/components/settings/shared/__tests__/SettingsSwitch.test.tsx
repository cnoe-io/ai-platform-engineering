/**
 * @jest-environment jsdom
 */

import { fireEvent,render,screen } from "@testing-library/react";

import { SettingsSwitch } from "../SettingsSwitch";

describe("SettingsSwitch",() => {
  it("anchors the thumb inside the track in both states",() => {
    const onCheckedChange = jest.fn();
    const { rerender } = render(
      <SettingsSwitch
        checked={false}
        label="Example setting"
        onCheckedChange={onCheckedChange}
      />,
    );

    const toggle = screen.getByRole("switch",{ name: "Example setting" });
    const thumb = toggle.querySelector("span > span");
    expect(thumb).toHaveClass("left-0","translate-x-0.5");

    rerender(
      <SettingsSwitch
        checked
        label="Example setting"
        onCheckedChange={onCheckedChange}
      />,
    );
    expect(thumb).toHaveClass("left-0","translate-x-[18px]");

    fireEvent.click(toggle);
    expect(onCheckedChange).toHaveBeenCalledWith(false);
  });
});
