import { z } from "zod";

export type Capacity = {
  readonly limit: number;
  readonly owned: Set<number>;
  launching: number;
};

const Limit = z.int().positive();

export const createCapacity = (limit: number): Capacity => ({
  launching: 0,
  limit: Limit.parse(limit),
  owned: new Set(),
});

export const reserve = (capacity: Capacity): void => {
  const used = capacity.launching + capacity.owned.size;
  if (used >= capacity.limit)
    throw new Error(
      `browser limit reached (${used}/${capacity.limit}); close one with chrome-cli kill --port <port>`,
    );
  capacity.launching += 1;
};

export const confirm = (capacity: Capacity, port: number): void => {
  capacity.launching -= 1;
  capacity.owned.add(port);
};

export const cancel = (capacity: Capacity): void => {
  capacity.launching -= 1;
};

export const release = (capacity: Capacity, port: number): void => {
  capacity.owned.delete(port);
};
