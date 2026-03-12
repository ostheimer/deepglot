import type { User } from "@prisma/client";

export function toAuthUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    image: user.image,
  };
}
