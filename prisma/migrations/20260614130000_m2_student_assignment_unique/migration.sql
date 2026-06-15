-- CreateIndex
CREATE UNIQUE INDEX "StudentAssignment_assignmentId_studentId_key" ON "StudentAssignment"("assignmentId", "studentId");
