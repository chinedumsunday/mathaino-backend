# EdTain API Reference — Phase 1

**Base URL:** `https://your-app.railway.app/api`

---

## Authentication Flow (Firebase + JWT)

Your Framer/React Native frontend handles auth like this:

1. **User signs up/logs in via Firebase Auth** (email+password on the client)
2. **Client gets a Firebase ID Token** → `firebase.auth().currentUser.getIdToken()`
3. **Client sends that token to your backend** → backend verifies it, creates/finds the PG user, returns a JWT
4. **All subsequent API calls** use the JWT in the `Authorization: Bearer <token>` header

---

## Endpoints

### Health Check
```
GET /api/health
```
No auth required. Use to test if the API is up.

---

### Auth

#### Register
```
POST /api/auth/register
Content-Type: application/json

{
  "email": "student@example.com",
  "password": "securepass123",
  "firstName": "Ada",
  "lastName": "Okonkwo",
  "phone": "+2348012345678",
  "role": "STUDENT",           // STUDENT | LECTURER | FACULTY
  
  // If STUDENT:
  "matricNumber": "STU/2024/001",
  "level": "400",
  "department": "Computer Science",

  // If LECTURER:
  "department": "Computer Science",
  "specialization": "AI/ML",

  // If FACULTY:
  "department": "Computer Science",
  "title": "Dean"
}

// Response 201:
{
  "success": true,
  "message": "Registration successful",
  "data": {
    "user": { ... },
    "accessToken": "eyJ...",
    "refreshToken": "eyJ..."
  }
}
```

#### Login (Firebase Token Exchange)
```
POST /api/auth/login
Content-Type: application/json

{
  "idToken": "firebase-id-token-from-client"
}

// Response 200:
{
  "success": true,
  "data": {
    "user": { ... },
    "accessToken": "eyJ...",
    "refreshToken": "eyJ..."
  }
}
```

#### Get Current User
```
GET /api/auth/me
Authorization: Bearer <accessToken>

// Response 200:
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "email": "...",
      "firstName": "...",
      "lastName": "...",
      "role": "STUDENT",
      "status": "ACTIVE",
      "studentProfile": { ... }
    }
  }
}
```

---

### User Management (Admin)

#### List Users
```
GET /api/users?role=STUDENT&status=ACTIVE&page=1&limit=20&search=ada
Authorization: Bearer <accessToken>
Roles: SUPER_ADMIN, FACULTY

// Response 200:
{
  "success": true,
  "data": {
    "users": [ ... ],
    "pagination": {
      "total": 150,
      "page": 1,
      "limit": 20,
      "totalPages": 8
    }
  }
}
```

#### Get Single User
```
GET /api/users/:id
Authorization: Bearer <accessToken>
Roles: SUPER_ADMIN, FACULTY
```

#### Change User Role
```
PATCH /api/users/:id/role
Authorization: Bearer <accessToken>
Roles: SUPER_ADMIN

{ "role": "LECTURER" }
```

#### Change User Status
```
PATCH /api/users/:id/status
Authorization: Bearer <accessToken>
Roles: SUPER_ADMIN, FACULTY

{ "status": "SUSPENDED" }
// ACTIVE | SUSPENDED | PENDING | DEACTIVATED
```

#### Update Own Profile
```
PATCH /api/users/profile
Authorization: Bearer <accessToken>
Roles: Any authenticated user

{
  "firstName": "Updated",
  "lastName": "Name",
  "phone": "+2348099999999",
  "bio": "CS student passionate about AI"
}
```

#### Dashboard Stats
```
GET /api/users/stats
Authorization: Bearer <accessToken>
Roles: SUPER_ADMIN

// Response 200:
{
  "success": true,
  "data": {
    "totalUsers": 250,
    "byRole": { "STUDENT": 200, "LECTURER": 30, "FACULTY": 15, "SUPER_ADMIN": 5 },
    "byStatus": { "ACTIVE": 230, "PENDING": 15, "SUSPENDED": 5 },
    "recentUsers": [ ... ]
  }
}
```

---

## Error Responses

All errors follow this shape:
```json
{
  "success": false,
  "error": {
    "message": "Validation failed",
    "details": [
      { "field": "email", "message": "\"email\" must be a valid email" }
    ]
  }
}
```

**Status codes:** 400 (validation), 401 (unauthorized), 403 (forbidden), 404 (not found), 409 (conflict), 429 (rate limited), 500 (server error)

---

## Role Permissions Matrix

| Action              | Super Admin | Faculty | Lecturer | Student |
|---------------------|:-----------:|:-------:|:--------:|:-------:|
| List all users      | ✅          | ✅      | ❌       | ❌      |
| View any user       | ✅          | ✅      | ❌       | ❌      |
| Change roles        | ✅          | ❌      | ❌       | ❌      |
| Suspend/activate    | ✅          | ✅      | ❌       | ❌      |
| Update own profile  | ✅          | ✅      | ✅       | ✅      |
| View dashboard stats| ✅          | ❌      | ❌       | ❌      |

---

## Framer / Figma Integration Notes

For your Framer prototype, each button/form maps to an endpoint:

- **Sign Up form** → `POST /api/auth/register`
- **Login form** → Firebase Auth on client → `POST /api/auth/login` with the ID token
- **Profile page** → `GET /api/auth/me` on load, `PATCH /api/users/profile` on save
- **Admin user table** → `GET /api/users` with filters
- **User detail modal** → `GET /api/users/:id`
- **Role change dropdown** → `PATCH /api/users/:id/role`
- **Status toggle** → `PATCH /api/users/:id/status`
- **Dashboard cards** → `GET /api/users/stats`
