import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form";
import { SidebarProvider, useSidebar } from "@/components/ui/sidebar";

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
afterEach(cleanup);

it("keeps form labels, validation and submission working through the public exports", async () => {
  const submit = vi.fn();
  function ExampleForm() {
    const form = useForm({ defaultValues: { ctc: "" } });
    return (
      <Form {...form}>
        <form onSubmit={form.handleSubmit((values) => submit(values))}>
          <FormField
            control={form.control}
            name="ctc"
            rules={{ required: "Informe o CTC" }}
            render={({ field }) => (
              <FormItem>
                <FormLabel>CTC</FormLabel>
                <FormControl>
                  <input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit">Salvar</Button>
        </form>
      </Form>
    );
  }
  render(<ExampleForm />);
  fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
  expect(await screen.findByText("Informe o CTC")).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "CTC" })).toHaveAttribute("aria-invalid", "true");
  expect(submit).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("textbox", { name: "CTC" }), {
    target: { value: "0000000001" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(submit).toHaveBeenCalledExactlyOnceWith({ ctc: "0000000001" }));
});

it("shares one sidebar context between the public provider and hook after module separation", () => {
  function Consumer() {
    const { state, toggleSidebar } = useSidebar();
    return <Button onClick={toggleSidebar}>Menu {state}</Button>;
  }
  render(
    <SidebarProvider>
      <Consumer />
    </SidebarProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Menu expanded" }));
  expect(screen.getByRole("button", { name: "Menu collapsed" })).toBeInTheDocument();
});
