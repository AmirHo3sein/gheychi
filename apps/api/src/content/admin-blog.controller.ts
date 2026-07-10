import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuditAction } from '../audit/audit.decorator';
import { AuditInterceptor } from '../audit/audit.interceptor';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ContentService } from './content.service';
import {
  AdminBlogPostQueryDto,
  CreateBlogCategoryDto,
  CreateBlogPostDto,
  UpdateBlogCategoryDto,
  UpdateBlogPostDto,
} from './dto/blog.dto';

@Controller('admin/blog')
@UseGuards(AuthGuard, RolesGuard)
@Roles('admin')
export class AdminBlogController {
  constructor(private readonly content: ContentService) {}

  @Get('posts')
  list(@Query() query: AdminBlogPostQueryDto) {
    return this.content.listPostsForAdmin(query);
  }

  @Get('posts/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.content.getPostForAdmin(id);
  }

  @Post('posts')
  @UseInterceptors(AuditInterceptor)
  @AuditAction('post.create', 'post')
  create(@Body() dto: CreateBlogPostDto) {
    return this.content.createPost(dto);
  }

  @Patch('posts/:id')
  @UseInterceptors(AuditInterceptor)
  @AuditAction('post.update', 'post')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBlogPostDto) {
    return this.content.updatePost(id, dto);
  }

  @Post('posts/:id/publish')
  @UseInterceptors(AuditInterceptor)
  @AuditAction('post.publish', 'post')
  publish(@Param('id', ParseUUIDPipe) id: string) {
    return this.content.publishPost(id);
  }

  @Post('posts/:id/unpublish')
  @UseInterceptors(AuditInterceptor)
  @AuditAction('post.unpublish', 'post')
  unpublish(@Param('id', ParseUUIDPipe) id: string) {
    return this.content.unpublishPost(id);
  }

  @Delete('posts/:id')
  @HttpCode(204)
  @UseInterceptors(AuditInterceptor)
  @AuditAction('post.delete', 'post')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.content.deletePost(id);
  }

  @Post('categories')
  @UseInterceptors(AuditInterceptor)
  @AuditAction('blogcategory.create', 'blogcategory')
  createCategory(@Body() dto: CreateBlogCategoryDto) {
    return this.content.createCategory(dto);
  }

  @Patch('categories/:id')
  @UseInterceptors(AuditInterceptor)
  @AuditAction('blogcategory.update', 'blogcategory')
  updateCategory(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateBlogCategoryDto) {
    return this.content.updateCategory(id, dto);
  }

  @Delete('categories/:id')
  @HttpCode(204)
  @UseInterceptors(AuditInterceptor)
  @AuditAction('blogcategory.delete', 'blogcategory')
  removeCategory(@Param('id', ParseIntPipe) id: number) {
    return this.content.deleteCategory(id);
  }
}
