const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function seed() {
  console.log('Seeding database...');

  // Create Super Admin (you'll need to create this user in Firebase first,
  // then paste the Firebase UID here)
  const superAdmin = await prisma.user.upsert({
    where: { email: 'admin@edtain.app' },
    update: {},
    create: {
      firebaseUid: 'REPLACE_WITH_FIREBASE_UID',
      email: 'admin@edtain.app',
      firstName: 'Super',
      lastName: 'Admin',
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
    },
  });

  console.log('Super Admin created:', superAdmin.email);

  // Create sample Faculty
  const faculty = await prisma.user.upsert({
    where: { email: 'faculty@edtain.app' },
    update: {},
    create: {
      firebaseUid: 'REPLACE_WITH_FIREBASE_UID_2',
      email: 'faculty@edtain.app',
      firstName: 'Jane',
      lastName: 'Faculty',
      role: 'FACULTY',
      status: 'ACTIVE',
      facultyProfile: {
        create: {
          department: 'Computer Science',
          title: 'Dean of Studies',
        },
      },
    },
  });

  console.log('Faculty created:', faculty.email);

  // Create sample Lecturer
  const lecturer = await prisma.user.upsert({
    where: { email: 'lecturer@edtain.app' },
    update: {},
    create: {
      firebaseUid: 'REPLACE_WITH_FIREBASE_UID_3',
      email: 'lecturer@edtain.app',
      firstName: 'John',
      lastName: 'Lecturer',
      role: 'LECTURER',
      status: 'ACTIVE',
      lecturerProfile: {
        create: {
          department: 'Computer Science',
          specialization: 'Machine Learning',
          yearsExperience: 5,
        },
      },
    },
  });

  console.log('Lecturer created:', lecturer.email);

  // Create sample Student
  const student = await prisma.user.upsert({
    where: { email: 'student@edtain.app' },
    update: {},
    create: {
      firebaseUid: 'REPLACE_WITH_FIREBASE_UID_4',
      email: 'student@edtain.app',
      firstName: 'Ada',
      lastName: 'Student',
      role: 'STUDENT',
      status: 'ACTIVE',
      studentProfile: {
        create: {
          matricNumber: 'STU/2024/001',
          department: 'Computer Science',
          level: '400',
        },
      },
    },
  });

  console.log('Student created:', student.email);
  console.log('Seed complete!');
}

seed()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
