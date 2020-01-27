import deepEqual from "deep-equal";

export function argsEqual(args1, args2) {
  if (args1 === args2) {
    return true;
  }

  if (
    args1 === undefined ||
    args2 === undefined ||
    args1 === null ||
    args2 === null
  ) {
    return false;
  }

  if (args1.length !== args2.length) {
    return false;
  }

  for (let i = 0; i < args1.length; i++) {
    const arg1 = args1[i];
    const arg2 = args2[i];

    if (arg1 instanceof Promise || arg2 instanceof Promise) {
      // If either arg is a promise, they must be strictly equal because deepEqual thinks all unresolved promises are
      // equivalent.
      if (arg1 !== arg2) {
        return false;
      }
    } else {
      // If neither is a promise, we can run deep equal to determine their equivalence.
      if (!deepEqual(arg1, arg2)) {
        return false;
      }
    }
  }

  return true;
}
