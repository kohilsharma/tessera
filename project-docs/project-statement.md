<div align="center">

# ADL Project Statement - May 2026

</div>

<div align="center">

# App Dev Lab Project - Open-Ended Full Stack Application

</div>

## Project Overview

In this course, students are required to design and develop a full-stack web application of their choice. Students are free to propose and build an application in any domain.

However, the technology stack and core system requirements mentioned in this document are mandatory and must be strictly followed.

The objective of this project is to evaluate your understanding of;

1. Full-stack architecture

2. REST API design

3. Authentication and Role-Based Access Control

4. Database modeling and relationships

5. Advanced querying and filtering

6. Business logic implementation

7. State management and UI integration

## Mandatory Technology Stack

The following stack must be used without exception:

## Backend

1. Node.js with Express - for building REST APIs

2. PostgreSQL - relational database

3. TypeORM - ORM for database interaction

4. Redis (Optional but Recommended) - for caching

## Frontend

1. ReactJS - UI development

2. Bootstrap / Tailwind CSS (Optional) - for styling

## Technical Enforcement Rules

1. The database must be created programmatically using TypeORM entities.

2. No manual table creation using external tools.

3. Authentication must be implemented using:

a. JWT-based authentication OR

b. Token-based authentication

4. Role-Based Access Control (RBAC) must be implemented.

5. All demos must run on your local machine.

## Core System Requirements (Mandatory for All Projects)

Regardless of the domain chosen, your application must include the following core architectural components.

## 1. Role-Based Access Control (RBAC)

- The system must support multiple user roles (minimum: 3 roles).

- Each role must

O Have clearly defined responsibilities and permissions

- Authentication must be implemented using JWT tokens

- Authorization must also be enforced at the API level, not only on the frontend.

## 2. Role-Based Access Control (RBAC)

- The system must support multiple user roles (minimum: 3 roles).

- Each role must:

    o Have clearly defined responsibilities and permissions

    o Be restricted from accessing unauthorized resources and functionalities

- Authentication must be implemented using JWT tokens

- Authorization must also be enforced at the API level, not only on the frontend.

## 3. Domain Modeling & Database Design

- The database must contain at least 3 core domain entities, excluding: Join tables

Pure many-to-many mapping tables

- Each entity should:

- Have well-defined relationships (One-to-One, One-to-Many, Many-to-One)

- Proper use of:

Primary and foreign keys

Constraints

o Indexing where appropriate

- You are expected to justify why entities exist and how they interact.

## 4. Role-Aware User Experience

- Each role must have:

- Each role must have:

  - Its own landing page or dashboard

- Dashboards/Views may be shared between roles only if it makes sense for the

- domain, but access and data visibility must still differ.

- Users should never see or interact with features outside their role.

## 5. Data Integrity & Security

- Sensitive operations must be protected at the API level.

- Passwords must be securely stored using hashing.

- Prevent invalid or inconsistent system states through:

    o Backend validation

    o Database constraints

- The system must gracefully handle:

    o Unauthorized access

    o Invalid input

    o Resource not found scenarios

## 6. Frontend Expectations

- The frontend should:

- The frontend should:

    o Consume APIs built by you

    o Reflect role-based behavior clearly

    o Handle loading, error, and empty states properly

- UI/UX need not be visually complex, but must be:

    o Intuitive

    o Consistent

    o Purpose-driven

## 2. Core Business Entity

Each application must define a primary business entity relevant to its domain and must have a total of minimum 3 entities.(excluding join relations)

## The Core Entity must include:

- Title / Name

- Description

- Date or Timestamp field (if applicable)

- Category or Type

- Capacity or Limit (if applicable)

- Media Support (image or file upload)

- Ownership relationship (linked to Role Type A)

Note: Students mav add additional fields as required.

## 3. Advanced Search and Filtering

Must include one or more of the;

- Keyword search

- Category filter

- Date range filter (if applicable)

- Pagination

- Sorting

- Availability filter (if applicable)

Optional Features (Encouraged but Not Mandatory)

- Redis caching for frequently accessed data

- Analytics dashboard

- Waitlist system

- Payment gateway simulation

- Notifications

- Email integration

- Performance optimization

- UI/UX enhancements

## Mandatory Project Confirmation & Initial Report

By End of Week 6, every student must submit a Project Confirmation Report containing the following:

1. Project Topic / Question Statement

- Clearly define:

Problem statement

Target users

Core functionality

Why this application is useful

2. Implemented / Planned Features

- List features implemented so far

- Map each feature to:

Admin functionality

- Role Type A functionality

O Role Type B functionality

- Clearly state how your application satisfies the mandatory core requirements of this document

3. Tech Stack Used and Purpose

Must explicitly mention why the following frameworks/libraries are used;

- Express

- PostgreSQL

- TypeORM

- React

- JWT/Token

- Redis (if used)

- Any additional tools/libraries used and justification

## 4. Additional Features (If Any)

- Extra features beyond core requirements

- Technology used for them

- Whether implemented or planned

- Architectural impact of those features

You can find a detailed template for the initial report below;

initial-report-template.pdf

## Evaluation Criteria

Projects will be evaluated based on:

1. Correct usage of mandatory tech stack

2. Proper database design and relationships

3. Clean API design

4. Role-based access implementation

5. Business logic enforcement

6. Search and filtering efficiency

7. UI integration with backend

8. Code structure and maintainability

9. Documentation quality

10. Innovation and additional features

## Important Notes

- Copying any previous term's implementation is strictly prohibited.

- Domain may vary, but architectural depth must remain equivalent.

- Superficial applications with minimal logic will receive low grades.

- The focus is on system design, implementation quality, and correct application of concepts.

- This capstone project is meant to simulate real-world application development, where requirements are not handed to you in detail. You are expected to make assumptions, justify decisions, and build a system that reflects both technical competence and engineering maturity.

- Choose a problem that challenges you—not one that merely checks boxes