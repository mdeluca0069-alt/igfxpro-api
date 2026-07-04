import { HTTPException } from "hono/http-exception";

export class BadRequestException extends HTTPException {
  constructor(message = "Bad Request") {
    super(400, { message });
  }
}

export class UnauthorizedException extends HTTPException {
  constructor(message = "Unauthorized") {
    super(401, { message });
  }
}

export class ForbiddenException extends HTTPException {
  constructor(message = "Forbidden") {
    super(403, { message });
  }
}

export class NotFoundException extends HTTPException {
  constructor(message = "Not Found") {
    super(404, { message });
  }
}
